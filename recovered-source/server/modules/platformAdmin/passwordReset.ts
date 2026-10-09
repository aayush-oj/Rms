import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getEnv, platformJwtSecret } from '../../config/env';
import { getDatabasePool } from '../../db/pool';
import { sendSmtpMessage, smtpConfigured } from '../../lib/smtp';
import { logger } from '../../lib/logger';
import { BadRequestError } from '../../shared/errors';
import { rateLimit } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import {
  platformAdminForgotPasswordSchema,
  platformAdminResetPasswordSchema,
} from './validation';

const GENERIC_RESPONSE = 'If an active account exists for that email, a 6-digit reset code has been sent.';

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashOtp(email: string, otp: string): string {
  return crypto
    .createHmac('sha256', platformJwtSecret(getEnv()))
    .update(`platform-admin:${normalizeEmail(email)}:${otp}`)
    .digest('hex');
}

async function sendPlatformResetOtp(email: string, otp: string): Promise<void> {
  await sendSmtpMessage({
    to: email,
    subject: 'MIH DineOS Platform password reset code',
    text: [
      'MIH DineOS Platform password reset',
      '',
      `Your verification code is: ${otp}`,
      '',
      'This code expires in 10 minutes and can only be used once.',
      'If you did not request this change, ignore this email and review your account security.',
    ].join('\n'),
    html: `
      <div style="margin:0;background:#f4f7f3;padding:36px 16px;font-family:Arial,Helvetica,sans-serif;color:#17352a">
        <div style="max-width:540px;margin:0 auto;overflow:hidden;border:1px solid #dce7de;border-radius:20px;background:#ffffff;box-shadow:0 14px 38px rgba(7,60,42,.08)">
          <div style="background:#07583f;padding:24px 30px;color:#ffffff">
            <div style="font-size:22px;font-weight:800;letter-spacing:.2px">MIH <span style="color:#ff9418">DineOS</span></div>
            <div style="margin-top:5px;font-size:12px;letter-spacing:.08em;opacity:.82">PLATFORM ADMINISTRATION</div>
          </div>
          <div style="padding:32px 30px">
            <div style="display:inline-block;border-radius:999px;background:#fff1df;padding:6px 10px;font-size:11px;font-weight:800;letter-spacing:.08em;color:#a44c00">SECURE ACCOUNT RECOVERY</div>
            <h1 style="margin:18px 0 10px;font-size:23px;line-height:1.3;color:#17352a">Reset your Platform password</h1>
            <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#55655d">Enter this one-time verification code in the MIH DineOS God View. The code is valid for 10 minutes.</p>
            <div style="margin:22px 0;padding:20px;border:1px solid #dbe7de;border-radius:15px;background:#f4f8f4;text-align:center;font-size:34px;font-weight:800;letter-spacing:9px;color:#07583f">${otp}</div>
            <p style="margin:0;font-size:13px;line-height:1.65;color:#66766e">For your security, this code works once. A successful reset signs out every existing Platform session.</p>
            <p style="margin:20px 0 0;border-top:1px solid #e5ebe6;padding-top:18px;font-size:12px;line-height:1.6;color:#7a8982">If you did not request this change, ignore this email and review your account security.</p>
          </div>
        </div>
      </div>
    `,
  });
}

const forgotLimiter = rateLimit({
  keyPrefix: 'platform:auth:forgot-password',
  windowMs: 15 * 60 * 1000,
  max: 5,
  key: req => `${req.ip}:${normalizeEmail(String(req.body?.email || ''))}`,
});

const resetLimiter = rateLimit({
  keyPrefix: 'platform:auth:reset-password',
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: req => `${req.ip}:${normalizeEmail(String(req.body?.email || ''))}`,
});

export const platformPasswordResetRouter = Router();

platformPasswordResetRouter.post(
  '/forgot-password',
  forgotLimiter,
  validateRequest({ body: platformAdminForgotPasswordSchema }),
  async (req, res, next) => {
    try {
      if (!smtpConfigured()) {
        res.status(503).json({
          success: false,
          error: {
            code: 'EMAIL_SERVICE_UNAVAILABLE',
            message: 'Platform password recovery email is not configured yet.',
          },
        });
        return;
      }

      const email = normalizeEmail(req.body.email);
      const pool = getDatabasePool();
      const [admins] = await pool.execute<RowDataPacket[]>(
        `SELECT id, email
           FROM platform_admins
          WHERE LOWER(email) = ?
            AND is_active = TRUE
          LIMIT 1`,
        [email],
      );

      if (admins.length === 1) {
        const admin = admins[0];
        const otp = String(crypto.randomInt(100000, 1000000));
        const otpHash = hashOtp(email, otp);
        const connection = await pool.getConnection();
        let resetId = 0;
        try {
          await connection.beginTransaction();
          await connection.execute(
            `UPDATE platform_admin_password_reset_otps
                SET consumed_at = COALESCE(consumed_at, NOW())
              WHERE platform_admin_id = ?
                AND consumed_at IS NULL`,
            [Number(admin.id)],
          );
          const [insert] = await connection.execute<ResultSetHeader>(
            `INSERT INTO platform_admin_password_reset_otps
              (platform_admin_id, email, otp_hash, expires_at)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
            [Number(admin.id), email, otpHash],
          );
          resetId = Number(insert.insertId);
          await connection.commit();
        } catch (error) {
          await connection.rollback().catch(() => undefined);
          throw error;
        } finally {
          connection.release();
        }

        try {
          await sendPlatformResetOtp(email, otp);
        } catch (error) {
          await pool.execute(
            'UPDATE platform_admin_password_reset_otps SET consumed_at = NOW() WHERE id = ?',
            [resetId],
          );
          // Do not turn a recipient-specific SMTP failure into an account
          // enumeration signal. The internal error remains observable in logs.
          logger.error('Failed to deliver Platform password reset email.', { error });
        }
      }

      res.status(200).json({ success: true, data: { message: GENERIC_RESPONSE } });
    } catch (error) {
      next(error);
    }
  },
);

platformPasswordResetRouter.post(
  '/reset-password',
  resetLimiter,
  validateRequest({ body: platformAdminResetPasswordSchema }),
  async (req, res, next) => {
    const email = normalizeEmail(req.body.email);
    const submittedHash = hashOtp(email, req.body.otp);
    const pool = getDatabasePool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT pro.id, pro.platform_admin_id, pro.otp_hash, pro.attempts,
                pro.expires_at, pro.consumed_at, pa.is_active
           FROM platform_admin_password_reset_otps pro
           INNER JOIN platform_admins pa ON pa.id = pro.platform_admin_id
          WHERE LOWER(pro.email) = ?
          ORDER BY pro.id DESC
          LIMIT 1
          FOR UPDATE`,
        [email],
      );

      const row = rows[0];
      const expired = row ? new Date(row.expires_at).getTime() <= Date.now() : true;
      const hashesMatch = row
        ? crypto.timingSafeEqual(Buffer.from(String(row.otp_hash)), Buffer.from(submittedHash))
        : false;
      const invalid = !row
        || row.consumed_at != null
        || !row.is_active
        || expired
        || Number(row.attempts) >= 5
        || !hashesMatch;

      if (invalid) {
        if (row && row.consumed_at == null && !expired && Number(row.attempts) < 5) {
          await connection.execute(
            'UPDATE platform_admin_password_reset_otps SET attempts = attempts + 1 WHERE id = ?',
            [Number(row.id)],
          );
          await connection.commit();
        } else {
          await connection.rollback();
        }
        throw new BadRequestError(
          'The reset code is invalid or expired.',
          'PLATFORM_RESET_CODE_INVALID',
        );
      }

      const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
      const platformAdminId = Number(row.platform_admin_id);
      await connection.execute(
        `UPDATE platform_admins
            SET password_hash = ?,
                must_change_password = FALSE,
                updated_at = NOW()
          WHERE id = ?`,
        [passwordHash, platformAdminId],
      );
      await connection.execute(
        `UPDATE platform_admin_password_reset_otps
            SET consumed_at = NOW()
          WHERE platform_admin_id = ?
            AND consumed_at IS NULL`,
        [platformAdminId],
      );
      await connection.execute(
        `UPDATE platform_admin_sessions
            SET is_revoked = TRUE,
                revoked_at = COALESCE(revoked_at, NOW())
          WHERE platform_admin_id = ?
            AND is_revoked = FALSE`,
        [platformAdminId],
      );
      await connection.commit();

      res.status(200).json({
        success: true,
        data: { message: 'Platform password reset successfully. Sign in with your new password.' },
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // A committed invalid-attempt counter or successful reset must not be replaced by rollback noise.
      }
      next(error);
    } finally {
      connection.release();
    }
  },
);
