function safeCustomerImportFailure(error) {
  if (error?.code === '23505') {
    return {
      reason: 'Import error',
      fix: 'Check that this HNO and customer code are unique, then retry this row.'
    };
  }
  return {
    reason: 'Import error',
    fix: 'Check this row against the template and retry it. Contact an administrator if it still fails.'
  };
}

module.exports = { safeCustomerImportFailure };
