jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { initials } from '../initials';
import { recentLoginInitials } from '@/features/auth/recentLogins';

describe('initials', () => {
  it('ignores brackets and punctuation', () => {
    expect(initials('Ramesh (Head chef)')).toBe('RH');
    expect(initials('anil.kumar@shop.in')).toBe('AK');
  });
  it('handles single names and empty values', () => {
    expect(initials('Sana')).toBe('SA');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('recent logins on the sign-in screen', () => {
  it('uses letters only, never brackets ("Ramesh (Head chef)" was "R(")', () => {
    expect(recentLoginInitials({ name: 'Ramesh (Head chef)', email: 'ramesh@shop.in' })).toBe('RH');
    expect(recentLoginInitials({ name: '(Owner) Priya', email: 'priya@shop.in' })).toBe('OP');
    expect(recentLoginInitials({ name: null, email: 'anil.kumar@shop.in' })).toBe('AK');
    expect(recentLoginInitials({ name: '', email: 'sana@shop.in' })).toBe('SA');
  });
});
