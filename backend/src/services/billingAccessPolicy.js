const { ApiError } = require('../utils/asyncHandler');

function assertCashierPaymentDepartment(actor, departmentKey) {
  if (actor?.role === 'Cashier' && !['bottled_water', 'ice'].includes(departmentKey))
    throw new ApiError(403, 'Cashiers may only receive payments for Bottled Water or Ice, with a department selected');
}

module.exports = { assertCashierPaymentDepartment };
