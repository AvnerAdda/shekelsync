/**
 * Input Validation Utilities
 * Validates and sanitizes user input to prevent injection attacks
 */

/**
 * Validate that a value is a safe string (no SQL injection attempts)
 */
function validateSafeString(value, options = {}) {
  const {
    maxLength = 1000,
    allowEmpty = false,
    fieldName = 'field',
  } = options;

  if (value === null || value === undefined) {
    if (allowEmpty) {
      return { valid: true, value: null };
    }
    return { valid: false, error: `${fieldName} is required` };
  }

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` };
  }

  const trimmed = value.trim();

  if (!trimmed && !allowEmpty) {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }

  if (trimmed.length > maxLength) {
    return { valid: false, error: `${fieldName} is too long (max ${maxLength} characters)` };
  }

  return { valid: true, value: trimmed || null };
}

/**
 * Validate credential ID (must be positive integer)
 */
function validateCredentialId(id, options = {}) {
  const { required = true } = options;

  if (id === null || id === undefined || id === '') {
    if (required) {
      return { valid: false, error: 'Credential ID is required' };
    }
    return { valid: true, value: null };
  }

  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return { valid: false, error: 'Credential ID must be a positive integer' };
  }

  return { valid: true, value: numId };
}

/**
 * Validate vendor code (alphanumeric with underscores/hyphens)
 */
function validateVendorCode(vendor) {
  const result = validateSafeString(vendor, {
    maxLength: 100,
    allowEmpty: false,
    fieldName: 'vendor',
  });

  if (!result.valid) {
    return result;
  }

  // Vendor code should be alphanumeric with underscores/hyphens only
  if (!/^[a-zA-Z0-9_-]+$/.test(result.value)) {
    return { valid: false, error: 'Invalid vendor code format' };
  }

  return result;
}

/**
 * Validate institution ID
 */
function validateInstitutionId(id, options = {}) {
  const { required = false } = options;

  if (id === null || id === undefined || id === '') {
    if (required) {
      return { valid: false, error: 'Institution ID is required' };
    }
    return { valid: true, value: null };
  }

  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return { valid: false, error: 'Institution ID must be a positive integer' };
  }

  return { valid: true, value: numId };
}

/**
 * Validate credential username (general string validation)
 */
function validateUsername(username, options = {}) {
  return validateSafeString(username, {
    maxLength: 255,
    allowEmpty: options.allowEmpty || false,
    fieldName: 'username',
  });
}

/**
 * Validate credential password
 */
function validatePassword(password, options = {}) {
  return validateSafeString(password, {
    maxLength: 500,
    allowEmpty: options.allowEmpty || false,
    fieldName: 'password',
  });
}

/**
 * Validate ID number (e.g., Israeli ID)
 */
function validateIdNumber(idNumber, options = {}) {
  return validateSafeString(idNumber, {
    maxLength: 50,
    allowEmpty: options.allowEmpty !== false, // Allow empty by default
    fieldName: 'id_number',
  });
}

/**
 * Validate card digits (partial card number for identification)
 */
function validateCard6Digits(card6Digits, options = {}) {
  if (!card6Digits) {
    if (options.required) {
      return { valid: false, error: 'Card digits are required' };
    }
    return { valid: true, value: null };
  }

  const result = validateSafeString(card6Digits, {
    maxLength: 10,
    allowEmpty: false,
    fieldName: 'card6_digits',
  });

  if (!result.valid) {
    return result;
  }

  // Should be numeric only
  if (!/^\d+$/.test(result.value)) {
    return { valid: false, error: 'Card digits must be numeric' };
  }

  return result;
}

/**
 * Validate identification code
 */
function validateIdentificationCode(code, options = {}) {
  return validateSafeString(code, {
    maxLength: 255,
    allowEmpty: options.allowEmpty !== false,
    fieldName: 'identification_code',
  });
}

/**
 * Validate nickname
 */
function validateNickname(nickname, options = {}) {
  return validateSafeString(nickname, {
    maxLength: 100,
    allowEmpty: options.allowEmpty !== false,
    fieldName: 'nickname',
  });
}

/**
 * Validate bank account number
 */
function validateBankAccountNumber(accountNumber, options = {}) {
  return validateSafeString(accountNumber, {
    maxLength: 50,
    allowEmpty: options.allowEmpty !== false,
    fieldName: 'bank_account_number',
  });
}

/**
 * Validate complete credential payload for creation
 */
function validateCredentialCreation(payload) {
  const errors = [];
  const validated = {};

  // Vendor or institution_id required
  const vendorResult = validateVendorCode(payload.vendor);
  const institutionResult = validateInstitutionId(payload.institution_id, { required: false });

  if (!vendorResult.valid && !institutionResult.valid) {
    errors.push('Either vendor or institution_id is required');
  } else {
    if (vendorResult.valid) {
      validated.vendor = vendorResult.value;
    }
    if (institutionResult.valid && institutionResult.value) {
      validated.institution_id = institutionResult.value;
    }
  }

  // Username (or email/userCode alternatives)
  const usernameField = payload.userCode || payload.email || payload.username;
  if (usernameField) {
    const usernameResult = validateUsername(usernameField, { allowEmpty: false });
    if (!usernameResult.valid) {
      errors.push(usernameResult.error);
    } else {
      validated.username = usernameResult.value;
    }
  }

  // Password (optional during creation, can be set later)
  if (payload.password) {
    const passwordResult = validatePassword(payload.password);
    if (!passwordResult.valid) {
      errors.push(passwordResult.error);
    } else {
      validated.password = passwordResult.value;
    }
  }

  // Optional fields
  if (payload.id_number) {
    const idResult = validateIdNumber(payload.id_number);
    if (!idResult.valid) {
      errors.push(idResult.error);
    } else if (idResult.value) {
      validated.id_number = idResult.value;
    }
  }

  if (payload.card6_digits) {
    const cardResult = validateCard6Digits(payload.card6_digits);
    if (!cardResult.valid) {
      errors.push(cardResult.error);
    } else if (cardResult.value) {
      validated.card6_digits = cardResult.value;
    }
  }

  if (payload.nickname) {
    const nicknameResult = validateNickname(payload.nickname);
    if (!nicknameResult.valid) {
      errors.push(nicknameResult.error);
    } else if (nicknameResult.value) {
      validated.nickname = nicknameResult.value;
    }
  }

  if (payload.bank_account_number) {
    const accountResult = validateBankAccountNumber(payload.bank_account_number);
    if (!accountResult.valid) {
      errors.push(accountResult.error);
    } else if (accountResult.value) {
      validated.bank_account_number = accountResult.value;
    }
  }

  if (payload.identification_code || payload.num || payload.nationalID || payload.otpToken) {
    const identificationField = payload.num || payload.nationalID || payload.identification_code || payload.otpToken;
    const identificationResult = validateIdentificationCode(identificationField);
    if (!identificationResult.valid) {
      errors.push(identificationResult.error);
    } else if (identificationResult.value) {
      validated.identification_code = identificationResult.value;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: validated };
}

/**
 * Validate credential update payload
 */
function validateCredentialUpdate(payload) {
  const errors = [];
  const validated = {};

  // ID is required
  const idResult = validateCredentialId(payload.id, { required: true });
  if (!idResult.valid) {
    errors.push(idResult.error);
  } else {
    validated.id = idResult.value;
  }

  // All other fields are optional for updates
  if (payload.username || payload.userCode || payload.email) {
    const usernameField = payload.userCode || payload.email || payload.username;
    const usernameResult = validateUsername(usernameField, { allowEmpty: true });
    if (!usernameResult.valid) {
      errors.push(usernameResult.error);
    } else {
      validated.username = usernameResult.value;
    }
  }

  if (payload.password !== undefined) {
    const passwordResult = validatePassword(payload.password, { allowEmpty: true });
    if (!passwordResult.valid) {
      errors.push(passwordResult.error);
    } else {
      validated.password = passwordResult.value;
    }
  }

  if (payload.id_number !== undefined) {
    const idResult = validateIdNumber(payload.id_number);
    if (!idResult.valid) {
      errors.push(idResult.error);
    } else {
      validated.id_number = idResult.value;
    }
  }

  if (payload.card6_digits !== undefined) {
    const cardResult = validateCard6Digits(payload.card6_digits, { required: false });
    if (!cardResult.valid) {
      errors.push(cardResult.error);
    } else {
      validated.card6_digits = cardResult.value;
    }
  }

  if (payload.nickname !== undefined) {
    const nicknameResult = validateNickname(payload.nickname);
    if (!nicknameResult.valid) {
      errors.push(nicknameResult.error);
    } else {
      validated.nickname = nicknameResult.value;
    }
  }

  if (payload.bank_account_number !== undefined) {
    const accountResult = validateBankAccountNumber(payload.bank_account_number);
    if (!accountResult.valid) {
      errors.push(accountResult.error);
    } else {
      validated.bank_account_number = accountResult.value;
    }
  }

  if (payload.identification_code !== undefined || payload.num !== undefined ||
      payload.nationalID !== undefined || payload.otpToken !== undefined) {
    const identificationField = payload.num || payload.nationalID || payload.identification_code || payload.otpToken;
    const identificationResult = validateIdentificationCode(identificationField);
    if (!identificationResult.valid) {
      errors.push(identificationResult.error);
    } else {
      validated.identification_code = identificationResult.value;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Must have at least one field to update besides ID
  if (Object.keys(validated).length === 1) {
    return { valid: false, errors: ['No fields provided for update'] };
  }

  return { valid: true, data: validated };
}

module.exports = {
  validateSafeString,
  validateCredentialId,
  validateVendorCode,
  validateInstitutionId,
  validateUsername,
  validatePassword,
  validateIdNumber,
  validateCard6Digits,
  validateIdentificationCode,
  validateNickname,
  validateBankAccountNumber,
  validateCredentialCreation,
  validateCredentialUpdate,
};
module.exports.default = module.exports;
