import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(c:PoolConnection,table:string,column:string){const [r]=await c.execute<RowDataPacket[]>(`SELECT COUNT(*) count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`,[table,column]);return Number(r[0]?.count||0)>0;}
async function indexExists(c:PoolConnection,table:string,index:string){const [r]=await c.execute<RowDataPacket[]>(`SELECT COUNT(*) count FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?`,[table,index]);return Number(r[0]?.count||0)>0;}

export const migration022ReportsAndDashboard:MigrationDefinition={
  name:'022_reports_and_dashboard',
  up:async(c)=>{
    if(!(await columnExists(c,'bill_lines','item_classification_snapshot'))) await c.query(`ALTER TABLE bill_lines ADD COLUMN item_classification_snapshot ENUM('FOOD','BEVERAGE','OTHER') NULL AFTER menu_item_id`);
    if(!(await columnExists(c,'bill_lines','category_id_snapshot'))) await c.query(`ALTER TABLE bill_lines ADD COLUMN category_id_snapshot BIGINT UNSIGNED NULL AFTER item_classification_snapshot`);
    if(!(await columnExists(c,'bill_lines','category_name_snapshot'))) await c.query(`ALTER TABLE bill_lines ADD COLUMN category_name_snapshot VARCHAR(120) NULL AFTER category_id_snapshot`);
    if(!(await columnExists(c,'bill_lines','department_id_snapshot'))) await c.query(`ALTER TABLE bill_lines ADD COLUMN department_id_snapshot BIGINT UNSIGNED NULL AFTER category_name_snapshot`);
    if(!(await columnExists(c,'bill_lines','department_name_snapshot'))) await c.query(`ALTER TABLE bill_lines ADD COLUMN department_name_snapshot VARCHAR(120) NULL AFTER department_id_snapshot`);
    await c.query(`UPDATE bill_lines bl LEFT JOIN menu_items mi ON mi.id=bl.menu_item_id LEFT JOIN menu_categories mc ON mc.id=mi.category_id LEFT JOIN departments d ON d.id=mi.department_id SET bl.item_classification_snapshot=COALESCE(bl.item_classification_snapshot,mi.item_classification,'OTHER'),bl.category_id_snapshot=COALESCE(bl.category_id_snapshot,mi.category_id),bl.category_name_snapshot=COALESCE(bl.category_name_snapshot,mc.name),bl.department_id_snapshot=COALESCE(bl.department_id_snapshot,mi.department_id),bl.department_name_snapshot=COALESCE(bl.department_name_snapshot,d.name) WHERE bl.item_classification_snapshot IS NULL OR bl.category_name_snapshot IS NULL OR bl.department_name_snapshot IS NULL`);
    if(!(await indexExists(c,'bill_lines','idx_bill_lines_reporting'))) await c.query(`ALTER TABLE bill_lines ADD INDEX idx_bill_lines_reporting (organization_id,branch_id,item_classification_snapshot,category_id_snapshot,department_id_snapshot)`);
    if(!(await indexExists(c,'bills','idx_bills_report_scope'))) await c.query(`ALTER TABLE bills ADD INDEX idx_bills_report_scope (organization_id,branch_id,status,business_day_id,business_date,shift_id)`);
    if(!(await indexExists(c,'orders','idx_orders_report_scope'))) await c.query(`ALTER TABLE orders ADD INDEX idx_orders_report_scope (organization_id,branch_id,business_day_id,order_status,waiter_id,dining_table_id)`);
    const permissions:[string,string,string][]=[
      ['reports.dashboard.view','reports','View management dashboard'],['reports.sales.view','reports','View sales and control reports'],['reports.fnb.view','reports','View F&B performance'],['reports.department.view','reports','View department performance'],['reports.staff.view','reports','View operational staff performance'],['reports.occupancy.view','reports','View occupancy and table performance'],['reports.payment.view','reports','View payment reports'],['reports.tax.view','reports','View internal tax reports'],['reports.shift.view','reports','View shift/cash reports'],['reports.inventory.view','reports','View inventory reports'],['reports.purchasing.view','reports','View purchasing and supplier reports'],['reports.expense.view','reports','View expense reports'],['reports.branch.view','reports','View authorized branch comparison'],['reports.export','reports','Export authorized reports']
    ];
    for(const p of permissions) await c.query(`INSERT INTO permissions(code,module,description) VALUES(?,?,?) ON DUPLICATE KEY UPDATE module=VALUES(module),description=VALUES(description)`,p);
    const [manager]=await c.query<RowDataPacket[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name='FB_MANAGER' LIMIT 1`);
    if(manager.length){for(const [code] of permissions){const [p]=await c.query<RowDataPacket[]>(`SELECT id FROM permissions WHERE code=? LIMIT 1`,[code]);if(p.length) await c.query(`INSERT IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)`,[manager[0].id,p[0].id]);}}
    const [cashier]=await c.query<RowDataPacket[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name='CASHIER' LIMIT 1`);
    if(cashier.length){for(const code of ['reports.dashboard.view','reports.sales.view','reports.payment.view','reports.shift.view']){const [p]=await c.query<RowDataPacket[]>(`SELECT id FROM permissions WHERE code=? LIMIT 1`,[code]);if(p.length) await c.query(`INSERT IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)`,[cashier[0].id,p[0].id]);}}
  },
  down:async(c)=>{
    if(await indexExists(c,'orders','idx_orders_report_scope')) await c.query(`ALTER TABLE orders DROP INDEX idx_orders_report_scope`);
    if(await indexExists(c,'bills','idx_bills_report_scope')) await c.query(`ALTER TABLE bills DROP INDEX idx_bills_report_scope`);
    if(await indexExists(c,'bill_lines','idx_bill_lines_reporting')) await c.query(`ALTER TABLE bill_lines DROP INDEX idx_bill_lines_reporting`);
  }
};
