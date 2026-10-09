import { Pool, RowDataPacket } from 'mysql2/promise';
import { AuthContext } from '../identity/types';
import { ResolvedReportScope } from './service';
import { ReportFilters } from './types';

export type Classification = 'FOOD' | 'BEVERAGE' | 'OTHER';
export interface FnbFilters extends ReportFilters { classification?: Classification; period?: 'current' | 'previous' | 'all'; }
export const canViewFnbCosts = (user: AuthContext | undefined) => !!user && (user.role === 'OWNER' || user.permissions.includes('admin:all') || user.permissions.includes('recipe:view_cost'));
const n = (v: unknown) => Number(v ?? 0);
const round = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000;
const ratio = (a: number, b: number) => b ? round(a / b) : null;
export interface FnbCosts { theoreticalRecipeCost?: number | null; foodCostPercent?: number | null; grossMarginPercent?: number | null; grossProfit?: number | null; }
export interface FnbItem extends FnbCosts {
  itemId: number | null; item: string; classification: Classification; categoryId: number | null; category: string;
  departmentId: number | null; department: string; quantity: number; netSales: number; discounts: number; averageSellingPrice: number | null;
}
interface Aggregate { quantity: number; netSales: number; discounts: number; cost: number; missing: number; }
const empty = (): Aggregate => ({quantity:0,netSales:0,discounts:0,cost:0,missing:0});
const add = (a: Aggregate,b: Aggregate) => { a.quantity+=b.quantity; a.netSales+=b.netSales; a.discounts+=b.discounts;a.cost+=b.cost;a.missing+=b.missing; };
function costs(a: Aggregate, allowed: boolean): FnbCosts {
  if (!allowed) return {};
  const available = a.missing === 0 && a.quantity > 0;
  return { theoreticalRecipeCost:available?round(a.cost):null, foodCostPercent:available?ratio(a.cost*100,a.netSales):null,
    grossMarginPercent:available?ratio((a.netSales-a.cost)*100,a.netSales):null, grossProfit:available?round(a.netSales-a.cost):null };
}

export function projectFnb(rows: RowDataPacket[], includeCosts: boolean) {
  const groups = {FOOD:empty(),BEVERAGE:empty(),OTHER:empty()};
  const categories = new Map<string, Aggregate & {categoryId:number|null;category:string;classification:Classification}>();
  const items: FnbItem[] = rows.map(r=>{
    const classification = r.classification as Classification;
    const a = {quantity:n(r.quantity),netSales:n(r.net_sales),discounts:n(r.discounts),cost:n(r.recipe_cost),missing:n(r.missing_cost)};
    add(groups[classification],a);
    const categoryId=r.category_id==null?null:n(r.category_id);
    const key=JSON.stringify([categoryId,String(r.category),classification]);
    const category=categories.get(key)??{...empty(),categoryId,category:String(r.category),classification};
    add(category,a);categories.set(key,category);
    return {itemId:r.item_id==null?null:n(r.item_id),item:String(r.item),classification,categoryId,category:String(r.category),departmentId:r.department_id==null?null:n(r.department_id),department:String(r.department),quantity:a.quantity,netSales:round(a.netSales),discounts:round(a.discounts),averageSellingPrice:ratio(a.netSales,a.quantity),...costs(a,includeCosts)};
  });
  items.sort((a,b)=>b.netSales-a.netSales||(a.itemId??0)-(b.itemId??0));
  const food=groups.FOOD, beverage=groups.BEVERAGE, fnb=empty(); add(fnb,food);add(fnb,beverage);
  const categoryRows=[...categories.values()].map(a=>({categoryId:a.categoryId,category:a.category,classification:a.classification,quantity:a.quantity,netSales:round(a.netSales),discounts:round(a.discounts),averageItemValue:ratio(a.netSales,a.quantity),contributionPercent:a.classification==='OTHER'?null:ratio(a.netSales*100,fnb.netSales),...costs(a,includeCosts)})).sort((a,b)=>b.netSales-a.netSales);
  return {costsVisible:includeCosts,summary:{foodSales:round(food.netSales),beverageSales:round(beverage.netSales),foodItemsSold:food.quantity,beverageItemsSold:beverage.quantity,foodPercent:ratio(food.netSales*100,fnb.netSales),beveragePercent:ratio(beverage.netSales*100,fnb.netSales),averageFoodItemValue:ratio(food.netSales,food.quantity),averageBeverageItemValue:ratio(beverage.netSales,beverage.quantity),netFnbSales:round(fnb.netSales),...costs(fnb,includeCosts)},
    rows:items,categories:categoryRows,topFoodItems:items.filter(r=>r.classification==='FOOD').slice(0,10),topBeverageItems:items.filter(r=>r.classification==='BEVERAGE').slice(0,10)};
}

export function fnbQuery(scope: ResolvedReportScope, filters: FnbFilters, includeCosts: boolean) {
  const clauses = ['b.organization_id=?',`b.branch_id IN (${scope.branchIds.map(()=>'?').join(',')})`,"b.status='FINALIZED'"];
  const params:(string|number)[]=[scope.organizationId,...scope.branchIds];
  for(const [key,column] of [['businessDayId','b.business_day_id'],['shiftId','b.shift_id'],['registerId','b.register_id'],['departmentId','(CASE WHEN bl.item_classification_snapshot IS NOT NULL THEN bl.department_id_snapshot ELSE mi.department_id END)'],['categoryId','COALESCE(bl.category_id_snapshot,mi.category_id)'],['itemId','bl.menu_item_id']] as const){if(filters[key]){clauses.push(`${column}=?`);params.push(filters[key]!);}}
  if(filters.from){clauses.push('b.business_date>=?');params.push(filters.from);}
  if(filters.to){clauses.push('b.business_date<=?');params.push(filters.to);}
  const classification="COALESCE(bl.item_classification_snapshot,mi.item_classification,'OTHER')";
  if(filters.classification){clauses.push(`${classification}=?`);params.push(filters.classification);}
  const costSelect=includeCosts?`SUM(rs.total_cost_snapshot*(bl.quantity/NULLIF(oi.quantity,0))) recipe_cost,
    SUM(CASE WHEN rs.order_item_id IS NULL OR oi.quantity IS NULL OR oi.quantity<=0 THEN 1 ELSE 0 END) missing_cost`:'NULL recipe_cost, 0 missing_cost';
  const costJoins=includeCosts?`LEFT JOIN order_items oi ON oi.id=bl.order_item_id AND oi.order_id=b.order_id
    LEFT JOIN order_item_recipe_snapshots rs ON rs.order_item_id=bl.order_item_id AND rs.organization_id=b.organization_id AND rs.branch_id=b.branch_id`:'';
  return {sql:`SELECT bl.menu_item_id item_id,bl.item_name_snapshot item,${classification} classification,
    COALESCE(bl.category_id_snapshot,mi.category_id) category_id,COALESCE(bl.category_name_snapshot,mc.name,'Unassigned') category,
    (CASE WHEN bl.item_classification_snapshot IS NOT NULL THEN bl.department_id_snapshot ELSE mi.department_id END) department_id,COALESCE(bl.department_name_snapshot,d.name,'Unassigned') department,
    SUM(bl.quantity) quantity,SUM(bl.line_subtotal-bl.discount_amount) net_sales,SUM(bl.discount_amount) discounts,${costSelect}
    FROM bills b JOIN bill_lines bl ON bl.bill_id=b.id AND bl.organization_id=b.organization_id AND bl.branch_id=b.branch_id
    LEFT JOIN menu_items mi ON mi.id=bl.menu_item_id AND mi.organization_id=b.organization_id
    LEFT JOIN menu_categories mc ON mc.id=COALESCE(bl.category_id_snapshot,mi.category_id) AND mc.organization_id=b.organization_id
    LEFT JOIN departments d ON d.id=(CASE WHEN bl.item_classification_snapshot IS NOT NULL THEN bl.department_id_snapshot ELSE mi.department_id END) AND d.organization_id=b.organization_id AND (d.branch_id IS NULL OR d.branch_id=b.branch_id)
    ${costJoins} WHERE ${clauses.join(' AND ')}
    GROUP BY bl.menu_item_id,bl.item_name_snapshot,classification,COALESCE(bl.category_id_snapshot,mi.category_id),category,(CASE WHEN bl.item_classification_snapshot IS NOT NULL THEN bl.department_id_snapshot ELSE mi.department_id END),department
    ORDER BY net_sales DESC,item_id`,params};
}
export async function fnbReport(pool: Pick<Pool,'execute'>,scope:ResolvedReportScope,filters:FnbFilters,includeCosts=false){
  const query=fnbQuery(scope,filters,includeCosts);
  const [rows]=await pool.execute<RowDataPacket[]>(query.sql,query.params);
  return projectFnb(rows,includeCosts);
}

export async function fnbOptions(pool: Pick<Pool,'execute'>,scope:ResolvedReportScope){
  const branchPlaceholders=scope.branchIds.map(()=>'?').join(',');
  const [rows]=await pool.execute<RowDataPacket[]>(`SELECT mi.id itemId,mi.name item,mi.category_id categoryId,mc.name category,mi.department_id departmentId,d.name department
    FROM menu_items mi LEFT JOIN menu_categories mc ON mc.id=mi.category_id AND mc.organization_id=mi.organization_id
    LEFT JOIN departments d ON d.id=mi.department_id AND d.organization_id=mi.organization_id
      AND (d.branch_id IS NULL OR d.branch_id IN (${branchPlaceholders}))
    WHERE mi.organization_id=? AND mi.is_available=TRUE
      AND (mi.department_id IS NULL OR d.id IS NOT NULL)
    ORDER BY d.name,mc.name,mi.name`,[...scope.branchIds,scope.organizationId]);
  return rows.map(r=>({itemId:n(r.itemId),item:String(r.item),categoryId:r.categoryId==null?null:n(r.categoryId),category:r.category==null?'Unassigned':String(r.category),departmentId:r.departmentId==null?null:n(r.departmentId),department:r.department==null?'Unassigned':String(r.department)}));
}

export async function fnbPeriod(pool: Pick<Pool,'execute'>, scope: ResolvedReportScope, filters: FnbFilters): Promise<FnbFilters> {
  if (filters.period === 'all' || filters.businessDayId || filters.from || filters.to || scope.branchIds.length !== 1) return filters;

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, business_date, status, opened_at
     FROM business_days
     WHERE organization_id = ? AND branch_id = ?
     ORDER BY business_date DESC, opened_at DESC
     LIMIT 10`,
    [scope.organizationId, scope.branchIds[0]]
  );

  if (!rows.length) return { ...filters, businessDayId: -1 };

  const currentIndex = rows.findIndex((row) => String(row.status) === 'OPEN');
  const current = currentIndex >= 0 ? rows[currentIndex] : rows[0];

  if (filters.period === 'previous') {
    const previous = rows.find((row) => n(row.id) !== n(current.id) && String(row.business_date) <= String(current.business_date));
    return { ...filters, businessDayId: previous ? n(previous.id) : -1 };
  }

  return { ...filters, businessDayId: n(current.id) };
}
