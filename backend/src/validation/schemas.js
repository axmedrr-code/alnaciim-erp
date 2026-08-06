const { z } = require('zod');

const id = z.coerce.number().int().positive();
const money = z.coerce.number().nonnegative();
const qty = z.coerce.number().positive();
const qtyNonNeg = z.coerce.number().nonnegative();
const idOptional = z.union([id, z.null()]).optional();

// ---- auth ----
const login = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1)
  })
});

// ---- products / categories / warehouses ----
const productCreate = z.object({
  body: z.object({
    sku: z.string().min(1),
    barcode: z.string().optional().nullable(),
    name: z.string().min(1),
    category_id: id,
    product_type: z.enum(['raw_material', 'finished_good', 'spare_part']),
    unit: z.string().min(1),
    unit_cost: money.optional(),
    unit_price: money.optional(),
    reorder_level: qtyNonNeg.optional(),
    reorder_qty: qtyNonNeg.optional()
  })
});

const productUpdate = z.object({
  body: z.object({
    sku: z.string().min(1).optional(),
    barcode: z.string().optional().nullable(),
    name: z.string().min(1).optional(),
    category_id: id.optional(),
    product_type: z.enum(['raw_material', 'finished_good', 'spare_part']).optional(),
    unit: z.string().min(1).optional(),
    unit_cost: money.optional(),
    unit_price: money.optional(),
    reorder_level: qtyNonNeg.optional(),
    reorder_qty: qtyNonNeg.optional(),
    is_active: z.boolean().optional()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const categoryCreate = z.object({
  body: z.object({
    name: z.string().min(1),
    parent_id: idOptional,
    product_type: z.enum(['raw_material', 'finished_good', 'spare_part'])
  })
});

const warehouseCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['raw_material', 'finished_goods', 'spare_parts', 'general']),
    location: z.string().optional().nullable(),
    manager_id: idOptional
  })
});

const warehouseUpdate = z.object({
  body: z.object({
    code: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    type: z.enum(['raw_material', 'finished_goods', 'spare_parts', 'general']).optional(),
    location: z.string().optional().nullable(),
    manager_id: idOptional,
    is_active: z.boolean().optional()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

// ---- inventory ----
const stockMovementCreate = z.object({
  body: z.object({
    product_id: id,
    warehouse_id: id,
    movement_type: z.enum(['IN', 'OUT', 'ADJUSTMENT']),
    quantity: qty,
    reference_type: z.enum(['purchase', 'production', 'sales', 'maintenance', 'transfer', 'adjustment']).optional(),
    reference_id: id.optional(),
    notes: z.string().optional().nullable()
  })
});

const stockTransferCreate = z.object({
  body: z.object({
    product_id: id,
    from_warehouse_id: id,
    to_warehouse_id: id,
    quantity: qty,
    notes: z.string().optional().nullable()
  }).refine((b) => b.from_warehouse_id !== b.to_warehouse_id, { message: 'from_warehouse_id and to_warehouse_id must differ' })
});

// ---- production ----
const machineCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['RO_PLANT', 'FILLING_LINE', 'ICE_MACHINE', 'PACKAGING', 'GENERATOR', 'VEHICLE']),
    warehouse_id: idOptional,
    purchase_date: z.string().optional().nullable(),
    specifications: z.record(z.string(), z.any()).optional().nullable()
  })
});

const usageLogCreate = z.object({
  body: z.object({
    log_date: z.string().min(1),
    shift: z.enum(['Morning', 'Afternoon', 'Night']).optional().nullable(),
    hours_used: qtyNonNeg,
    output_quantity: qtyNonNeg.optional().nullable(),
    output_unit: z.string().optional().nullable(),
    notes: z.string().optional().nullable()
  })
});

const downtimeCreate = z.object({
  body: z.object({
    start_time: z.string().min(1),
    category: z.enum(['breakdown', 'scheduled_maintenance', 'power_outage', 'other']),
    reason: z.string().optional().nullable()
  })
});

const downtimeResolve = z.object({
  body: z.object({
    end_time: z.string().optional()
  })
});

const batchCreate = z.object({
  body: z.object({
    batch_number: z.string().min(1),
    production_type: z.enum(['RO_WATER', 'BOTTLING', 'ICE']),
    machine_id: id,
    product_id: idOptional,
    planned_qty: qtyNonNeg.optional(),
    unit: z.string().min(1),
    shift: z.enum(['Morning', 'Afternoon', 'Night']).optional().nullable(),
    start_time: z.string().optional().nullable(),
    destination_warehouse_id: idOptional,
    notes: z.string().optional().nullable()
  })
});

// Only allowed while status is 'planned' or 'in_progress' — completion is what
// posts stock movements, so anything before that is still a safe-to-edit draft.
const batchUpdate = z.object({
  body: z.object({
    product_id: idOptional,
    machine_id: id.optional(),
    planned_qty: qtyNonNeg.optional(),
    unit: z.string().min(1).optional(),
    shift: z.enum(['Morning', 'Afternoon', 'Night']).optional().nullable(),
    start_time: z.string().optional().nullable(),
    destination_warehouse_id: idOptional,
    notes: z.string().optional().nullable()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const batchComplete = z.object({
  body: z.object({
    actual_qty: qtyNonNeg,
    wastage_qty: qtyNonNeg.optional(),
    wastage_notes: z.string().optional().nullable(),
    materials_warehouse_id: idOptional,
    materials: z.array(z.object({
      product_id: id,
      quantity_used: qty,
      warehouse_id: id
    })).optional(),
    // QC sign-off decides whether this batch's output ever becomes real,
    // loadable finished-goods stock — 'failed' completes the batch (for the
    // record) but posts no stock receipt at all.
    qc_status: z.enum(['pending', 'passed', 'failed'])
  })
});

// ---- bill of materials ----
const bomCreate = z.object({
  body: z.object({
    product_id: id,
    name: z.string().min(1),
    items: z.array(z.object({
      raw_material_product_id: id,
      quantity_per_unit: z.coerce.number().positive()
    })).min(1, 'At least one BOM line item is required')
  })
});

// ---- sales ----
const orderItem = z.object({
  product_id: id,
  quantity: qty,
  unit_price: money,
  discount: money.optional()
});

const quotationCreate = z.object({
  body: z.object({
    customer_id: id,
    valid_until: z.string().optional().nullable(),
    items: z.array(orderItem).min(1, 'At least one item is required'),
    discount: money.optional(),
    tax: money.optional(),
    notes: z.string().optional().nullable(),
    cost_center_id: idOptional,
    project_id: idOptional
  })
});

// Only meaningful while the quotation is still 'draft' — nothing has been sent to the
// customer yet at that point, so a full replace of items/amounts is safe.
const quotationUpdate = z.object({
  body: z.object({
    customer_id: id.optional(),
    valid_until: z.string().optional().nullable(),
    items: z.array(orderItem).min(1, 'At least one item is required').optional(),
    discount: money.optional(),
    tax: money.optional(),
    notes: z.string().optional().nullable(),
    cost_center_id: idOptional,
    project_id: idOptional
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const quotationConvert = z.object({
  body: z.object({
    sale_type: z.enum(['cash', 'credit']).optional(),
    cash_payment_method: z.enum(['cash', 'bank_transfer', 'cheque']).optional(),
    delivery_date: z.string().optional().nullable()
  })
});

// ---- cost centers & projects ----
const costCenterCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['production', 'sales', 'delivery', 'procurement', 'maintenance', 'warehouse', 'hr', 'finance', 'administration'])
  })
});

const costCenterUpdate = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    is_active: z.boolean().optional()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const projectCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    customer_id: idOptional,
    cost_center_id: idOptional,
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    budget_amount: money.optional(),
    notes: z.string().optional().nullable()
  })
});

const projectUpdate = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    customer_id: idOptional,
    cost_center_id: idOptional,
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    budget_amount: money.optional(),
    status: z.enum(['active', 'on_hold', 'completed', 'cancelled']).optional(),
    notes: z.string().optional().nullable()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

// ---- vehicle & machine costs ----
const vehicleExpenseCreate = z.object({
  body: z.object({
    truck_id: id,
    category: z.enum(['fuel', 'repairs', 'tires', 'oil', 'driver_salary', 'insurance', 'parking', 'license', 'other']),
    amount: qty,
    expense_date: z.string().optional().nullable(),
    odometer_km: z.coerce.number().nonnegative().optional().nullable(),
    description: z.string().optional().nullable(),
    cost_center_id: idOptional,
    payment_method: z.enum(['cash', 'bank_transfer', 'cheque']).optional(),
    bank_account_id: idOptional
  })
});

const machineCostCreate = z.object({
  body: z.object({
    category: z.enum(['fuel_power', 'parts', 'labor', 'other']),
    amount: qty,
    cost_date: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    cost_center_id: idOptional,
    payment_method: z.enum(['cash', 'bank_transfer', 'cheque']).optional(),
    bank_account_id: idOptional
  })
});

// ---- route operations (Water Distribution Operating System) ----
// A route's stop list is built from already-approved Bulk Water sales orders,
// not a free customer picker — order_ids is the list of sales_orders to assign.
// No operator field — drivers record their own deliveries, no separate
// operator assignment happens at planning time.
const routeRunCreate = z.object({
  body: z.object({
    qaade_id: idOptional,
    route_date: z.string().optional().nullable(),
    truck_id: id,
    driver_id: id,
    salesman_id: idOptional,
    order_ids: z.array(id).optional()
  })
});

const routeRunUpdate = z.object({
  body: z.object({
    truck_id: id.optional(),
    driver_id: id.optional(),
    salesman_id: idOptional,
    order_ids: z.array(id).optional()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const routeLoadCreate = z.object({
  body: z.object({
    truck_id: id,
    warehouse_id: id,
    product_id: id,
    measured_liters: qty,
    seal_number: z.string().min(1)
  })
});

const routeReturnCreate = z.object({
  body: z.object({
    warehouse_id: id,
    measured_liters: qtyNonNeg
  })
});

const exceptionCreate = z.object({
  body: z.object({
    type: z.enum(['shortage', 'leakage', 'customer_dispute', 'wrong_delivery', 'missing_payment']),
    route_run_id: idOptional,
    route_stop_id: idOptional,
    truck_id: idOptional,
    payment_id: idOptional,
    description: z.string().optional().nullable(),
    quantity: z.coerce.number().optional().nullable(),
    amount: money.optional().nullable()
  })
});

const exceptionResolve = z.object({
  body: z.object({
    resolution_notes: z.string().optional().nullable()
  })
});

const cashReconcile = z.object({
  body: z.object({
    actual_cash: money,
    actual_mobile_money: money.optional(),
    actual_bank: money.optional(),
    notes: z.string().optional().nullable()
  })
});

const waterReconcile = z.object({
  body: z.object({
    returned_liters: qtyNonNeg
  })
});

const salesOrderCreate = z.object({
  body: z.object({
    customer_id: id,
    delivery_date: z.string().optional().nullable(),
    items: z.array(orderItem).min(1, 'At least one item is required'),
    discount: money.optional(),
    tax: money.optional(),
    delivery_fee: money.optional(),
    sale_type: z.enum(['cash', 'credit']).optional(),
    cash_payment_method: z.enum(['cash', 'bank_transfer', 'cheque']).optional(),
    notes: z.string().optional().nullable(),
    cost_center_id: idOptional,
    project_id: idOptional,
    customer_tank_id: idOptional,
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional()
  })
});

// Only meaningful while the order is still 'pending' — nothing has posted to the
// ledger yet at that point, so a full replace of items/amounts is safe.
const salesOrderUpdate = z.object({
  body: z.object({
    customer_id: id.optional(),
    delivery_date: z.string().optional().nullable(),
    items: z.array(orderItem).min(1, 'At least one item is required').optional(),
    discount: money.optional(),
    tax: money.optional(),
    delivery_fee: money.optional(),
    notes: z.string().optional().nullable(),
    cost_center_id: idOptional,
    project_id: idOptional
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

// Shared by every module's "Reverse" action.
const reverseRequest = z.object({
  body: z.object({
    reason: z.string().optional().nullable()
  })
});

const dispatchCreate = z.object({
  body: z.object({
    truck_id: id,
    driver_id: id,
    warehouse_id: idOptional,
    delivery_address: z.string().optional().nullable(),
    truck_load_id: idOptional,
    customer_tank_id: idOptional
  }).refine((b) => b.warehouse_id || b.truck_load_id, {
    message: 'Either warehouse_id or truck_load_id is required'
  })
});

const deliveryStatusUpdate = z.object({
  body: z.object({
    status: z.enum(['scheduled', 'in_transit', 'delivered', 'failed']),
    pod_reference: z.string().optional().nullable(),
    last_known_lat: z.coerce.number().optional().nullable(),
    last_known_lng: z.coerce.number().optional().nullable()
  })
});

const deliveryConfirm = z.object({
  body: z.object({
    quantity_delivered: qty,
    signature_name: z.string().min(1, 'Customer signature/name is required'),
    last_known_lat: z.coerce.number().optional().nullable(),
    last_known_lng: z.coerce.number().optional().nullable(),
    pod_reference: z.string().optional().nullable()
  })
});

// ---- customer tanks ----
const tankCreate = z.object({
  body: z.object({
    tank_code: z.string().min(1),
    tank_name: z.string().optional().nullable(),
    customer_id: id,
    tank_type: z.enum(['tank', 'drum', 'underground_reservoir']),
    capacity_liters: qty,
    barcode: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    installed_date: z.string().optional().nullable(),
    notes: z.string().optional().nullable()
  })
});

const tankUpdate = z.object({
  body: z.object({
    tank_code: z.string().min(1).optional(),
    tank_name: z.string().optional().nullable(),
    tank_type: z.enum(['tank', 'drum', 'underground_reservoir']).optional(),
    capacity_liters: qty.optional(),
    barcode: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    installed_date: z.string().optional().nullable(),
    status: z.enum(['active', 'inactive']).optional(),
    notes: z.string().optional().nullable()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const tankMaintenanceCreate = z.object({
  body: z.object({
    log_date: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    cost: money.optional()
  })
});

// ---- tanker loading ----
const truckLoadCreate = z.object({
  body: z.object({
    truck_id: id,
    product_id: id,
    warehouse_id: id,
    // 0 (or omitted) is valid here — it means "open this Route Session using
    // the truck's existing remaining stock, don't deduct anything new from
    // the warehouse". The route handler itself enforces that 0 is only
    // accepted when the truck actually has existing stock to fall back on.
    quantity_loaded: z.coerce.number().min(0).optional(),
    notes: z.string().optional().nullable()
  })
});

const paymentCreate = z.object({
  body: z.object({
    amount: qty,
    method: z.enum(['cash', 'bank_transfer', 'cheque', 'credit']),
    reference_number: z.string().optional().nullable(),
    payment_date: z.string().optional().nullable(),
    bank_account_id: idOptional
  })
});

const customerCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['retail', 'wholesale', 'distributor', 'tanker']),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    credit_limit: money.optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    sales_rep_id: idOptional,
    qaade_id: idOptional
  })
});

const customerUpdate = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['retail', 'wholesale', 'distributor', 'tanker']).optional(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    credit_limit: money.optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    sales_rep_id: idOptional,
    qaade_id: idOptional,
    status: z.enum(['active', 'inactive', 'suspended', 'closed']).optional(),
    is_active: z.boolean().optional()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

// ---- qaades ----
const qaadeCreate = z.object({
  body: z.object({
    qaade_code: z.string().min(1),
    name: z.string().min(1),
    area: z.string().optional().nullable(),
    collector_id: idOptional,
    truck_id: idOptional,
    notes: z.string().optional().nullable()
  })
});

const qaadeUpdate = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    area: z.string().optional().nullable(),
    collector_id: idOptional,
    truck_id: idOptional,
    status: z.enum(['active', 'inactive']).optional(),
    notes: z.string().optional().nullable()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const truckCreate = z.object({
  body: z.object({
    plate_number: z.string().min(1),
    model: z.string().optional().nullable(),
    capacity: money.optional(),
    capacity_unit: z.string().optional().nullable(),
    assigned_driver_id: idOptional
  })
});

// ---- procurement ----
const supplierCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    category: z.enum(['raw_material', 'packaging', 'spare_part', 'chemicals']).optional().nullable(),
    contact_person: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    address: z.string().optional().nullable()
  })
});

const purchaseItem = z.object({
  product_id: id,
  quantity_ordered: qty,
  unit_cost: money
});

const purchaseOrderCreate = z.object({
  body: z.object({
    supplier_id: id,
    expected_date: z.string().optional().nullable(),
    items: z.array(purchaseItem).min(1, 'At least one item is required'),
    notes: z.string().optional().nullable(),
    cost_center_id: idOptional,
    project_id: idOptional
  })
});

// Only allowed before any goods have been received against the PO.
const purchaseOrderUpdate = z.object({
  body: z.object({
    supplier_id: id.optional(),
    expected_date: z.string().optional().nullable(),
    items: z.array(purchaseItem).min(1, 'At least one item is required').optional(),
    notes: z.string().optional().nullable(),
    cost_center_id: idOptional,
    project_id: idOptional
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const receiveItem = z.object({
  purchase_item_id: id,
  quantity_received: qty,
  condition: z.enum(['good', 'damaged']).optional()
});

const purchaseOrderReceive = z.object({
  body: z.object({
    items: z.array(receiveItem).min(1, 'At least one item is required'),
    warehouse_id: id,
    notes: z.string().optional().nullable()
  })
});

const supplierPerformanceCreate = z.object({
  body: z.object({
    supplier_id: id,
    purchase_order_id: id,
    on_time_delivery: z.boolean(),
    quality_rating: z.coerce.number().int().min(1).max(5),
    notes: z.string().optional().nullable()
  })
});

// ---- maintenance ----
const maintenanceScheduleCreate = z.object({
  body: z.object({
    machine_id: id,
    maintenance_type: z.enum(['preventive', 'corrective']),
    frequency_days: z.coerce.number().int().positive().optional().nullable(),
    last_done_date: z.string().optional().nullable(),
    next_due_date: z.string().optional().nullable(),
    assigned_to: idOptional,
    description: z.string().optional().nullable()
  })
});

const maintenanceLogCreate = z.object({
  body: z.object({
    machine_id: id,
    schedule_id: idOptional,
    downtime_id: idOptional,
    type: z.enum(['preventive', 'corrective', 'breakdown_repair']),
    cost_center_id: idOptional,
    description: z.string().optional().nullable(),
    cost: money.optional(),
    parts_used: z.array(z.object({
      product_id: id,
      quantity: qty,
      warehouse_id: id
    })).optional()
  })
});

// ---- finance ----
const expenseCreate = z.object({
  body: z.object({
    category_id: id,
    amount: qty,
    expense_date: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    related_reference_type: z.string().optional().nullable(),
    related_reference_id: id.optional().nullable(),
    payment_method: z.enum(['cash', 'bank_transfer', 'cheque']).optional(),
    bank_account_id: idOptional,
    // Every expense must belong to a cost center — there's no sensible default for a
    // generic expense the way there is for a sale (CC-SALES) or a PO (CC-PROC).
    cost_center_id: id,
    project_id: idOptional
  })
});

// ---- accounting ----
const coaAccountCreate = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    parent_id: idOptional
  })
});

const coaAccountUpdate = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    parent_id: idOptional,
    is_active: z.boolean().optional()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

const journalLine = z.object({
  account_id: id,
  debit: qtyNonNeg.optional(),
  credit: qtyNonNeg.optional(),
  description: z.string().optional().nullable(),
  customer_id: idOptional,
  supplier_id: idOptional
});

const journalEntryCreate = z.object({
  body: z.object({
    entry_date: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    status: z.enum(['draft', 'posted']).optional(),
    lines: z.array(journalLine).min(2, 'At least two lines are required')
  })
});

// Only allowed while status = 'draft'.
const journalEntryUpdate = z.object({
  body: z.object({
    entry_date: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    lines: z.array(journalLine).min(2, 'At least two lines are required')
  })
});

const cashEntryCreate = z.object({
  body: z.object({
    entry_date: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    amount: qty,
    other_account_id: id, // the non-cash side of the entry (e.g. Owner's Capital, an expense account, Sales Revenue)
    bank_account_id: idOptional, // omit to use Cash on Hand
    customer_id: idOptional,
    supplier_id: idOptional
  })
});

const bankAccountCreate = z.object({
  body: z.object({
    name: z.string().min(1),
    bank_name: z.string().optional().nullable(),
    account_number: z.string().optional().nullable(),
    opening_balance: money.optional()
  })
});

const supplierPaymentCreate = z.object({
  body: z.object({
    amount: qty,
    payment_date: z.string().optional().nullable(),
    method: z.enum(['cash', 'bank_transfer', 'cheque']),
    bank_account_id: idOptional,
    reference_number: z.string().optional().nullable()
  })
});

const budgetCreate = z.object({
  body: z.object({
    account_id: id,
    fiscal_year_id: id,
    period_month: z.coerce.number().int().min(1).max(12),
    budgeted_amount: money
  })
});

const fiscalYearCreate = z.object({
  body: z.object({
    name: z.string().min(1),
    start_date: z.string().min(1),
    end_date: z.string().min(1)
  })
});

// ---- users ----
const userCreate = z.object({
  body: z.object({
    employee_code: z.string().min(1),
    full_name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role_id: id,
    department: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    assigned_warehouse_id: idOptional
  })
});

const userUpdate = z.object({
  body: z.object({
    full_name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    role_id: id.optional(),
    department: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    assigned_warehouse_id: idOptional,
    is_active: z.boolean().optional(),
    commission_rate: z.coerce.number().min(0).max(100).optional().nullable()
  }).refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })
});

// ---- backups ----
const restoreBackupConfirm = z.object({
  body: z.object({
    confirm: z.literal('RESTORE', { message: 'Send { "confirm": "RESTORE" } to acknowledge this will overwrite the live database' })
  })
});

module.exports = {
  login,
  productCreate, productUpdate, categoryCreate,
  warehouseCreate, warehouseUpdate,
  stockMovementCreate, stockTransferCreate,
  machineCreate, usageLogCreate, downtimeCreate, downtimeResolve, batchCreate, batchUpdate, batchComplete,
  salesOrderCreate, salesOrderUpdate, dispatchCreate, deliveryStatusUpdate, deliveryConfirm, paymentCreate, customerCreate, customerUpdate, truckCreate,
  quotationCreate, quotationUpdate, quotationConvert,
  costCenterCreate, costCenterUpdate, projectCreate, projectUpdate,
  vehicleExpenseCreate, machineCostCreate,
  routeRunCreate, routeRunUpdate, routeLoadCreate, routeReturnCreate,
  exceptionCreate, exceptionResolve, cashReconcile, waterReconcile,
  tankCreate, tankUpdate, tankMaintenanceCreate, truckLoadCreate,
  bomCreate,
  qaadeCreate, qaadeUpdate,
  supplierCreate, purchaseOrderCreate, purchaseOrderUpdate, purchaseOrderReceive, supplierPerformanceCreate,
  maintenanceScheduleCreate, maintenanceLogCreate,
  expenseCreate,
  coaAccountCreate, coaAccountUpdate, journalEntryCreate, journalEntryUpdate, cashEntryCreate, bankAccountCreate,
  supplierPaymentCreate, budgetCreate, fiscalYearCreate,
  reverseRequest,
  userCreate, userUpdate,
  restoreBackupConfirm
};
