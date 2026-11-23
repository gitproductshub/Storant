/// <reference types="jest" />
import {
  kitchenRulesDefaults, kitchenRulesDirty, kitchenRulesFormOf, kitchenRulesPayload, orderTypesFor,
} from '../kitchenRules';

describe('kitchen rules form', () => {
  it('shows only the order types the business uses', () => {
    expect(orderTypesFor({ business_type: 'restaurant' })).toEqual(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
    expect(orderTypesFor({ business_type: 'cafe' })).toEqual(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
    expect(orderTypesFor({ business_type: 'cloud_kitchen' })).toEqual(['TAKEAWAY', 'DELIVERY']);
    expect(orderTypesFor({ business_type: 'retail' })).toEqual(['RETAIL_WALKIN', 'TAKEAWAY', 'DELIVERY']);
    // The server's list wins when it sends one
    expect(orderTypesFor({ business_type: 'restaurant', order_types: ['TAKEAWAY'] })).toEqual(['TAKEAWAY']);
    expect(orderTypesFor(null)).toEqual(['DINE_IN', 'TAKEAWAY', 'DELIVERY']);
  });

  it('fills from settings with the defaults (dine-in after served, others any time, Bump only clears)', () => {
    expect(kitchenRulesFormOf(null)).toEqual(kitchenRulesDefaults());
    expect(kitchenRulesDefaults()).toEqual({
      rules: { DINE_IN: 'served', TAKEAWAY: 'anytime', DELIVERY: 'anytime', RETAIL_WALKIN: 'anytime' }, bumpMarksServed: false,
    });
    const form = kitchenRulesFormOf({ pay_rules: { DINE_IN: 'ready', TAKEAWAY: 'nonsense' as never }, bump_marks_served: true });
    expect(form.rules.DINE_IN).toBe('ready');
    expect(form.rules.TAKEAWAY).toBe('anytime'); // unknown value → default
    expect(form.bumpMarksServed).toBe(true);
  });

  it('sends only the order types on screen, and knows when something changed', () => {
    const saved = kitchenRulesFormOf({ business_type: 'cloud_kitchen' });
    const types = orderTypesFor({ business_type: 'cloud_kitchen' });
    const edited = { ...saved, rules: { ...saved.rules, DELIVERY: 'served' as const } };
    expect(kitchenRulesDirty(saved, saved, types)).toBe(false);
    expect(kitchenRulesDirty(edited, saved, types)).toBe(true);
    // Dine-in is not on a cloud kitchen's screen: changing it there doesn't count
    expect(kitchenRulesDirty({ ...saved, rules: { ...saved.rules, DINE_IN: 'anytime' } }, saved, types)).toBe(false);
    expect(kitchenRulesDirty({ ...saved, bumpMarksServed: true }, saved, types)).toBe(true);
    expect(kitchenRulesPayload(edited, types)).toEqual({ pay_rules: { TAKEAWAY: 'anytime', DELIVERY: 'served' }, bump_marks_served: false });
  });
});
