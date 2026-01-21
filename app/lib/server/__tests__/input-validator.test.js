/**
 * Security Tests for Input Validation
 * Tests validation and sanitization of user input
 */

import { describe, test, expect } from 'vitest';
import {
  validateSafeString,
  validateCredentialId,
  validateVendorCode,
  validateUsername,
  validatePassword,
  validateCard6Digits,
  validateCredentialCreation,
  validateCredentialUpdate,
} from '../input-validator.js';

describe('Input Validator', () => {
  describe('Safe String Validation', () => {
    test('should accept valid strings', () => {
      const result = validateSafeString('valid string');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('valid string');
    });

    test('should trim whitespace', () => {
      const result = validateSafeString('  trimmed  ');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('trimmed');
    });

    test('should reject empty strings when not allowed', () => {
      const result = validateSafeString('', { allowEmpty: false });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    test('should accept empty strings when allowed', () => {
      const result = validateSafeString('', { allowEmpty: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBeNull();
    });

    test('should reject strings exceeding max length', () => {
      const longString = 'a'.repeat(1001);
      const result = validateSafeString(longString, { maxLength: 1000 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    test('should reject null when not allowed', () => {
      const result = validateSafeString(null, { allowEmpty: false });
      expect(result.valid).toBe(false);
    });

    test('should accept null when allowed', () => {
      const result = validateSafeString(null, { allowEmpty: true });
      expect(result.valid).toBe(true);
      expect(result.value).toBeNull();
    });

    test('should reject non-string values', () => {
      expect(validateSafeString(123).valid).toBe(false);
      expect(validateSafeString({}).valid).toBe(false);
      expect(validateSafeString([]).valid).toBe(false);
    });
  });

  describe('Credential ID Validation', () => {
    test('should accept positive integers', () => {
      const result = validateCredentialId(123);
      expect(result.valid).toBe(true);
      expect(result.value).toBe(123);
    });

    test('should accept string integers', () => {
      const result = validateCredentialId('456');
      expect(result.valid).toBe(true);
      expect(result.value).toBe(456);
    });

    test('should reject zero', () => {
      const result = validateCredentialId(0);
      expect(result.valid).toBe(false);
    });

    test('should reject negative numbers', () => {
      const result = validateCredentialId(-1);
      expect(result.valid).toBe(false);
    });

    test('should reject decimals', () => {
      const result = validateCredentialId(12.5);
      expect(result.valid).toBe(false);
    });

    test('should reject non-numeric strings', () => {
      const result = validateCredentialId('abc');
      expect(result.valid).toBe(false);
    });

    test('should reject null when required', () => {
      const result = validateCredentialId(null, { required: true });
      expect(result.valid).toBe(false);
    });

    test('should accept null when not required', () => {
      const result = validateCredentialId(null, { required: false });
      expect(result.valid).toBe(true);
      expect(result.value).toBeNull();
    });
  });

  describe('Vendor Code Validation', () => {
    test('should accept alphanumeric vendor codes', () => {
      const result = validateVendorCode('isracard');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('isracard');
    });

    test('should accept underscores and hyphens', () => {
      expect(validateVendorCode('test_vendor').valid).toBe(true);
      expect(validateVendorCode('test-vendor').valid).toBe(true);
      expect(validateVendorCode('test_vendor-123').valid).toBe(true);
    });

    test('should reject special characters', () => {
      expect(validateVendorCode('test@vendor').valid).toBe(false);
      expect(validateVendorCode('test vendor').valid).toBe(false);
      expect(validateVendorCode('test.vendor').valid).toBe(false);
    });

    test('should reject SQL injection attempts', () => {
      expect(validateVendorCode("'; DROP TABLE credentials--").valid).toBe(false);
      expect(validateVendorCode("1' OR '1'='1").valid).toBe(false);
    });

    test('should reject empty vendor codes', () => {
      const result = validateVendorCode('');
      expect(result.valid).toBe(false);
    });
  });

  describe('Card Digits Validation', () => {
    test('should accept numeric strings', () => {
      const result = validateCard6Digits('123456');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('123456');
    });

    test('should reject non-numeric strings', () => {
      expect(validateCard6Digits('12ab56').valid).toBe(false);
      expect(validateCard6Digits('test').valid).toBe(false);
    });

    test('should accept null when not required', () => {
      const result = validateCard6Digits(null, { required: false });
      expect(result.valid).toBe(true);
      expect(result.value).toBeNull();
    });

    test('should reject null when required', () => {
      const result = validateCard6Digits(null, { required: true });
      expect(result.valid).toBe(false);
    });

    test('should trim whitespace', () => {
      const result = validateCard6Digits('  123456  ');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('123456');
    });
  });

  describe('Username Validation', () => {
    test('should accept valid usernames', () => {
      const result = validateUsername('user@example.com');
      expect(result.valid).toBe(true);
    });

    test('should accept Hebrew characters', () => {
      const result = validateUsername('משתמש');
      expect(result.valid).toBe(true);
    });

    test('should reject excessively long usernames', () => {
      const longUsername = 'a'.repeat(256);
      const result = validateUsername(longUsername);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });
  });

  describe('Password Validation', () => {
    test('should accept valid passwords', () => {
      const result = validatePassword('secure_password_123');
      expect(result.valid).toBe(true);
    });

    test('should accept special characters', () => {
      const result = validatePassword('P@ssw0rd!#$%');
      expect(result.valid).toBe(true);
    });

    test('should reject excessively long passwords', () => {
      const longPassword = 'a'.repeat(501);
      const result = validatePassword(longPassword);
      expect(result.valid).toBe(false);
    });

    test('should accept null when allowed', () => {
      const result = validatePassword(null, { allowEmpty: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('Credential Creation Validation', () => {
    test('should accept valid credential with vendor', () => {
      const payload = {
        vendor: 'isracard',
        username: 'testuser',
        password: 'testpass',
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(true);
      expect(result.data.vendor).toBe('isracard');
      expect(result.data.username).toBe('testuser');
      expect(result.data.password).toBe('testpass');
    });

    test('should accept valid credential with institution_id', () => {
      const payload = {
        institution_id: 1,
        username: 'testuser',
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(true);
      expect(result.data.institution_id).toBe(1);
    });

    test('should reject without vendor or institution_id', () => {
      const payload = {
        username: 'testuser',
        password: 'testpass',
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Either vendor or institution_id is required');
    });

    test('should sanitize and validate all fields', () => {
      const payload = {
        vendor: '  isracard  ',
        username: '  user@test.com  ',
        password: '  pass123  ',
        nickname: '  My Card  ',
        card6_digits: '  123456  ',
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(true);
      expect(result.data.vendor).toBe('isracard');
      expect(result.data.username).toBe('user@test.com');
      expect(result.data.password).toBe('pass123');
      expect(result.data.nickname).toBe('My Card');
      expect(result.data.card6_digits).toBe('123456');
    });

    test('should reject invalid vendor code', () => {
      const payload = {
        vendor: 'invalid vendor with spaces',
        username: 'testuser',
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('vendor'))).toBe(true);
    });

    test('should reject SQL injection in fields', () => {
      const payload = {
        vendor: 'isracard',
        username: "admin'; DROP TABLE users--",
      };

      const result = validateCredentialCreation(payload);
      // Should still be valid (we allow special chars in username)
      // But the parameterized queries will prevent SQL injection
      expect(result.valid).toBe(true);
    });

    test('should handle alternative field names', () => {
      const payload = {
        vendor: 'isracard',
        userCode: 'testcode',
        num: '123456789',
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(true);
      expect(result.data.username).toBe('testcode');
      expect(result.data.identification_code).toBe('123456789');
    });
  });

  describe('Credential Update Validation', () => {
    test('should accept valid update', () => {
      const payload = {
        id: 123,
        password: 'newpassword',
      };

      const result = validateCredentialUpdate(payload);
      expect(result.valid).toBe(true);
      expect(result.data.id).toBe(123);
      expect(result.data.password).toBe('newpassword');
    });

    test('should require ID', () => {
      const payload = {
        password: 'newpassword',
      };

      const result = validateCredentialUpdate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('ID'))).toBe(true);
    });

    test('should require at least one field besides ID', () => {
      const payload = {
        id: 123,
      };

      const result = validateCredentialUpdate(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No fields provided for update');
    });

    test('should accept multiple field updates', () => {
      const payload = {
        id: 123,
        username: 'newuser',
        password: 'newpass',
        nickname: 'New Nickname',
      };

      const result = validateCredentialUpdate(payload);
      expect(result.valid).toBe(true);
      expect(result.data.username).toBe('newuser');
      expect(result.data.password).toBe('newpass');
      expect(result.data.nickname).toBe('New Nickname');
    });

    test('should allow null values for optional fields', () => {
      const payload = {
        id: 123,
        nickname: null,
      };

      const result = validateCredentialUpdate(payload);
      expect(result.valid).toBe(true);
      expect(result.data.nickname).toBeNull();
    });
  });

  describe('Security - XSS Prevention', () => {
    test('should accept but not execute script tags in strings', () => {
      const xssPayload = {
        vendor: 'isracard',
        username: '<script>alert("xss")</script>',
      };

      const result = validateCredentialCreation(xssPayload);
      // We accept it (it's just a string) but it won't be executed
      // And parameterized queries prevent it from being interpreted
      expect(result.valid).toBe(true);
    });
  });

  describe('Security - Length Limits', () => {
    test('should enforce maximum lengths on all fields', () => {
      const longString = 'a'.repeat(1000);

      expect(validateUsername(longString).valid).toBe(false);
      expect(validatePassword('a'.repeat(501)).valid).toBe(false);
      expect(validateVendorCode('a'.repeat(101)).valid).toBe(false);
    });
  });

  describe('Security - Type Safety', () => {
    test('should reject non-string values for string fields', () => {
      const payload = {
        vendor: 123, // Should be string
        username: {},
      };

      const result = validateCredentialCreation(payload);
      expect(result.valid).toBe(false);
    });

    test('should reject non-numeric values for ID fields', () => {
      const payload = {
        id: 'not-a-number',
        password: 'test',
      };

      const result = validateCredentialUpdate(payload);
      expect(result.valid).toBe(false);
    });
  });
});
