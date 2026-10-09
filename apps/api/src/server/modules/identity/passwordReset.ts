import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { getEnv } from '../../config/env';
import { getDatabasePool } from '../../db/pool';
import { rateLimit } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import { sendSmtpMessage, smtpConfigured } from '../../lib/smtp';

const requestResetSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

const resetPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(100),
});

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function otpHash(email: string, otp: string): string {
  return crypto.createHmac('sha256', getEnv().JWT_SECRET).update(`${normalizedEmail(email)}:${otp}`).digest('hex');
}

function emailConfigured(): boolean {
  return smtpConfigured();
}

async function sendResetOtp(email: string, username: string, otp: string): Promise<void> {
  await sendSmtpMessage({
    to: email,
    subject: 'MIH DineOS — Password reset code',
    text: [
      'MIH DineOS password reset',
      '',
      `Your DineOS username is: ${username}`,
      `Your verification code is: ${otp}`,
      '',
      'This code expires in 10 minutes and can only be used once.',
      'If you did not request a password reset, you can safely ignore this email.',
    ].join('\n'),
    html: `
      <div style="margin:0;background:#f7f8f6;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#17352a">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e8e4;border-radius:18px;overflow:hidden">
          <div style="background:#07583f;padding:22px 28px;color:#ffffff">
            <div style="font-size:21px;font-weight:800;letter-spacing:.2px">MIH <span style="color:#ff9418">DineOS</span></div>
            <div style="margin-top:4px;font-size:12px;opacity:.82">Restaurant Management System</div>
          </div>
          <div style="padding:30px 28px">
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#17352a">Reset your password</h1>
            <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#55655d">Use the verification code below to reset your MIH DineOS password.</p>
            <div style="margin:0 0 18px;padding:14px 16px;border-radius:12px;background:#f4f7f5;font-size:13px;color:#55655d">Your DineOS username: <strong style="color:#17352a">${username}</strong></div>
            <div style="margin:22px 0;padding:18px;border-radius:14px;background:#f4f7f5;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#07583f">${otp}</div>
            <p style="margin:0;font-size:13px;line-height:1.6;color:#66766e">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
            <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#7a8982">If you did not request a password reset, you can safely ignore this email.</p>
          </div>
        </div>
      </div>
    `,
  });
}

const forgotLimiter = rateLimit({
  keyPrefix: 'auth:forgot-password',
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: req => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`,
});

const resetLimiter = rateLimit({
  keyPrefix: 'auth:reset-password',
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: req => `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`,
});

export const passwordResetRouter = Router();

passwordResetRouter.post('/forgot-password', forgotLimiter, validateRequest({ body: requestResetSchema }), async (req, res, next) => {
  try {
    if (!emailConfigured()) {
      res.status(503).json({ success: false, error: { code: 'EMAIL_SERVICE_UNAVAILABLE', message: 'Password recovery email is not configured yet.' } });
      return;
    }

    const email = normalizedEmail(req.body.email);
    const pool = getDatabasePool();
    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT id, organization_id, username, email FROM users
       WHERE LOWER(email) = ? AND is_active = TRUE
       ORDER BY id ASC LIMIT 2`,
      [email]
    );

    // Always return the same response for unknown emails to prevent account enumeration.
    if (users.length === 1) {
      const user = users[0];
      const otp = String(crypto.randomInt(100000, 1000000));
      const hash = otpHash(email, otp);
      const conn = await pool.getConnection();
      let resetId = 0;
      try {
        await conn.beginTransaction();
        await conn.execute(
          `UPDATE password_reset_otps SET consumed_at = COALESCE(consumed_at, NOW())
           WHERE user_id = ? AND consumed_at IS NULL`,
          [Number(user.id)]
        );
        const [insert] = await conn.execute<ResultSetHeader>(
          `INSERT INTO password_reset_otps (organization_id, user_id, email, otp_hash, expires_at)
           VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
          [Number(user.organization_id), Number(user.id), email, hash]
        );
        resetId = Number(insert.insertId);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      try {
        await sendResetOtp(email, String(user.username), otp);
      } catch (err) {
        await pool.execute('UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = ?', [resetId]);
        throw err;
      }
    }

    res.status(200).json({ success: true, data: { message: 'If an active account exists for that email, a 6-digit reset code has been sent.' } });
  } catch (err) {
    next(err);
  }
});

passwordResetRouter.post('/reset-password', resetLimiter, validateRequest({ body: resetPasswordSchema }), async (req, res, next) => {
  try {
    const email = normalizedEmail(req.body.email);
    const submittedHash = otpHash(email, req.body.otp);
    const pool = getDatabasePool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT pro.id, pro.user_id, pro.organization_id, pro.otp_hash, pro.attempts, pro.expires_at,
                pro.consumed_at, u.is_active
         FROM password_reset_otps pro
         JOIN users u ON u.id = pro.user_id AND u.organization_id = pro.organization_id
         WHERE LOWER(pro.email) = ?
         ORDER BY pro.id DESC LIMIT 1 FOR UPDATE`,
        [email]
      );

      if (!rows.length) {
        await conn.rollback();
        res.status(400).json({ success: false, error: { code: 'RESET_CODE_INVALID', message: 'The reset code is invalid or expired.' } });
        return;
      }

      const row = rows[0];
      const expired = new Date(row.expires_at).getTime() <= Date.now();
      const invalid = row.consumed_at != null || !row.is_active || expired || Number(row.attempts) >= 5 || !crypto.timingSafeEqual(Buffer.from(String(row.otp_hash)), Buffer.from(submittedHash));

      if (invalid) {
        if (row.consumed_at == null && !expired && Number(row.attempts) < 5) {
          await conn.execute('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = ?', [Number(row.id)]);
          await conn.commit();
        } else {
          await conn.rollback();
        }
        res.status(400).json({ success: false, error: { code: 'RESET_CODE_INVALID', message: 'The reset code is invalid or expired.' } });
        return;
      }

      const passwordHash = await bcrypt.hash(req.body.newPassword, 10);
      await conn.execute(
        'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
        [passwordHash, Number(row.user_id), Number(row.organization_id)]
      );
      await conn.execute(
        'UPDATE password_reset_otps SET consumed_at = NOW() WHERE user_id = ? AND organization_id = ? AND consumed_at IS NULL',
        [Number(row.user_id), Number(row.organization_id)]
      );
      await conn.execute(
        'UPDATE sessions SET is_revoked = TRUE, revoked_at = NOW() WHERE user_id = ? AND organization_id = ? AND is_revoked = FALSE',
        [Number(row.user_id), Number(row.organization_id)]
      );
      await conn.commit();

      res.status(200).json({ success: true, data: { message: 'Password reset successfully. You can now sign in with your new password.' } });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});
