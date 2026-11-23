/// <reference types="jest" />
import { isIndianMobile, mobileError, normalizeMobileInput, startsLikePhone } from '../phone';

describe('Indian mobile numbers', () => {
  it('keeps digits only and stops at 10', () => {
    expect(normalizeMobileInput('98765')).toBe('98765');
    expect(normalizeMobileInput('98765432109999')).toBe('9876543210');
    expect(normalizeMobileInput('98a7b6')).toBe('9876');
  });

  it('normalises pasted numbers: spaces, dashes, brackets, +91 / 91 / 0', () => {
    expect(normalizeMobileInput('98765 43210')).toBe('9876543210');
    expect(normalizeMobileInput('(98765)-43210')).toBe('9876543210');
    expect(normalizeMobileInput('+91 98765 43210')).toBe('9876543210');
    expect(normalizeMobileInput('+91-98765-43210')).toBe('9876543210');
    expect(normalizeMobileInput('919876543210')).toBe('9876543210');
    expect(normalizeMobileInput('09876543210')).toBe('9876543210');
  });

  it('never mangles a real number that starts with 91 or 0', () => {
    expect(normalizeMobileInput('9198765432')).toBe('9198765432');
    expect(normalizeMobileInput('91987')).toBe('91987'); // still typing
    expect(normalizeMobileInput('0987')).toBe('0987');
  });

  it('accepts only 10 digits starting 6-9', () => {
    expect(isIndianMobile('9876543210')).toBe(true);
    expect(isIndianMobile('6000000000')).toBe(true);
    expect(isIndianMobile('5876543210')).toBe(false);
    expect(isIndianMobile('987654321')).toBe(false);
    expect(isIndianMobile('98765432101')).toBe(false);
  });

  it('explains the problem inline', () => {
    const msg = 'Enter a valid 10-digit Indian mobile number';
    expect(mobileError('5')).toBe(msg); // wrong first digit at once
    expect(mobileError('98765')).toBeNull(); // still typing
    expect(mobileError('98765', { final: true })).toBe(msg);
    expect(mobileError('9876543210', { final: true })).toBeNull();
    expect(mobileError('')).toBeNull();
  });

  it('tells a phone number from an email by its first character', () => {
    expect(startsLikePhone('9')).toBe(true);
    expect(startsLikePhone('+91')).toBe(true);
    expect(startsLikePhone('owner@shop.in')).toBe(false);
    expect(startsLikePhone('9owner@shop.in')).toBe(false);
    expect(startsLikePhone('')).toBe(false);
  });
});
