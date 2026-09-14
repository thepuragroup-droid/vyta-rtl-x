/**
 * Unit tests for the email builder's discount, cart and checkout blocks.
 *
 * These cover the rules that decide what a customer is told they will pay, so
 * getting them wrong is a promise the checkout won't keep:
 *   - a percentage over 100 or a negative amount is a typo, not a discount;
 *   - a fixed amount larger than the cart can't produce a negative total;
 *   - the same figure appears in the subject line, the message, the promo box,
 *     the cart totals and the plain-text alternative;
 *   - `{{discount}}` never reaches a customer as a literal, or as a hole in a
 *     sentence when no discount was attached;
 *   - a figure the ledger never gave us is left out rather than printed as
 *     "$0.00" — a nudge offering 20% off nothing is worse than a nudge that
 *     just names the cart;
 *   - only http(s) links are ever put in an href.
 *
 * The repo has no test runner wired up, so these use Node's built-in
 * `node:test` + `node:assert` (zero dependencies). Run with a TS-aware loader,
 * e.g. `node --test --import tsx lib/customer/promo-email.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDiscountTo,
  discountAmountOn,
  formatDiscount,
  knownAmount,
  normalizeDiscount,
  renderMergeFields,
  renderPromoEmail,
  renderPromoEmailText,
  renderSubject,
  safeHttpUrl,
  RECOVERY_TEMPLATE_MAP,
  RECOVERY_TEMPLATES,
  PROMO_TEMPLATES,
} from './promo-email';

// ---- normalizeDiscount ----------------------------------------------------

test('normalizeDiscount accepts the two supported shapes', () => {
  assert.deepEqual(normalizeDiscount('percentage', '15'), { type: 'percentage', value: 15 });
  assert.deepEqual(normalizeDiscount('fixed', 25.5), { type: 'fixed', value: 25.5 });
  // 100% off is a legitimate (if generous) offer.
  assert.deepEqual(normalizeDiscount('percentage', 100), { type: 'percentage', value: 100 });
});

test('normalizeDiscount rejects a typo rather than clamping it', () => {
  // 150 is far more likely "$150" typed into the percentage field than an
  // intended 100% discount, so it must not silently become a free order.
  assert.equal(normalizeDiscount('percentage', 150), null);
  assert.equal(normalizeDiscount('fixed', -5), null);
  assert.equal(normalizeDiscount('fixed', 0), null);
  assert.equal(normalizeDiscount('fixed', 'abc'), null);
  assert.equal(normalizeDiscount('bogus', 10), null);
  assert.equal(normalizeDiscount('percentage', ''), null);
});

// ---- The arithmetic -------------------------------------------------------

test('discountAmountOn computes both kinds', () => {
  assert.equal(discountAmountOn(200, { type: 'percentage', value: 15 }), 30);
  assert.equal(discountAmountOn(200, { type: 'fixed', value: 25 }), 25);
});

test('a fixed discount never exceeds the cart', () => {
  assert.equal(discountAmountOn(20, { type: 'fixed', value: 50 }), 20);
  assert.equal(applyDiscountTo(20, { type: 'fixed', value: 50 }), 0);
});

test('applyDiscountTo passes the subtotal through when there is no discount', () => {
  assert.equal(applyDiscountTo(199.99, null), 199.99);
  assert.equal(applyDiscountTo(null, { type: 'percentage', value: 10 }), null);
  assert.equal(applyDiscountTo(undefined, null), null);
});

test('formatDiscount states the offer one way', () => {
  assert.equal(formatDiscount({ type: 'percentage', value: 15 }), '15% off');
  assert.equal(formatDiscount({ type: 'fixed', value: 25 }), '$25.00 off');
});

// ---- Links ----------------------------------------------------------------

test('safeHttpUrl passes http(s) and drops everything else', () => {
  assert.equal(
    safeHttpUrl('https://pay.stealth.health/c/abc'),
    'https://pay.stealth.health/c/abc',
  );
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<script>'), null);
  assert.equal(safeHttpUrl(''), null);
  assert.equal(safeHttpUrl(null), null);
});

// ---- Merge fields ---------------------------------------------------------

test('{{discount}} is written from the structured discount', () => {
  assert.equal(
    renderMergeFields('here is {{discount}}', 'Sam', { type: 'percentage', value: 15 }),
    'here is 15% off',
  );
  assert.equal(
    renderMergeFields('here is {{discount}}', 'Sam', { type: 'fixed', value: 25 }),
    'here is $25.00 off',
  );
});

test('{{discount}} degrades to a readable sentence with no discount attached', () => {
  // An empty string would leave "here is ." in a customer's inbox.
  assert.equal(renderMergeFields('here is {{discount}}.', 'Sam'), 'here is a discount.');
  assert.equal(renderMergeFields('Hi {{first_name}}', null), 'Hi there');
});

// ---- Rendering ------------------------------------------------------------

const CART = {
  items: [
    { name: 'BPC-157 5mg (10-pack)', quantity: 2, lineTotal: 150 },
    { name: 'TB-500 5mg (single vial)', quantity: 1, lineTotal: 50 },
  ],
  subtotal: 200,
  currency: 'USD',
  reference: 'amc_test',
};

const RECOVERY = {
  firstName: 'Sam',
  subject: 'Your cart is still waiting, {{first_name}}',
  body: 'Hi {{first_name}},\n\nYou left something behind.',
  promoCode: 'COMEBACK15',
  discount: { type: 'percentage' as const, value: 15 },
  cart: CART,
  checkout: { url: 'https://pay.stealth.health/c/abc', label: 'Complete your order' },
};

test('the discount nudge puts the figure in the subject line', () => {
  const template = RECOVERY_TEMPLATE_MAP['recovery_discount'];
  assert.equal(
    renderSubject({ ...RECOVERY, subject: template.subject }),
    'Here is 15% off to finish your order, Sam',
  );
  // The same template with no amount entered is still a sentence.
  assert.equal(
    renderSubject({ ...RECOVERY, subject: template.subject, discount: null }),
    'Here is a discount to finish your order, Sam',
  );
});

test('the body carries the figure too, from the same number', () => {
  const template = RECOVERY_TEMPLATE_MAP['recovery_discount'];
  const html = renderPromoEmail({ ...RECOVERY, body: template.body });
  assert.match(html, /To help you finish your checkout, here is 15% off\./);
  // One number, entered once: the prose cannot disagree with the box.
  assert.doesNotMatch(html, /\{\{/);
});

test('the recovery email carries the cart, the code and the link', () => {
  const html = renderPromoEmail(RECOVERY);
  assert.match(html, /BPC-157 5mg \(10-pack\)/);
  assert.match(html, /COMEBACK15/);
  assert.match(html, /href="https:\/\/pay\.stealth\.health\/c\/abc"/);
  assert.match(html, /Complete your order/);
  // Subtotal, the saving and the discounted total all appear.
  assert.match(html, /\$200\.00 USD/);
  assert.match(html, /−\$30\.00 USD/);
  assert.match(html, /\$170\.00 USD/);
  // And the total is labelled as an estimate, because PuraMass does the real sum.
  assert.match(html, /Estimated total/);
});

test('the masthead leads with the figure and what it saves on this cart', () => {
  const html = renderPromoEmail(RECOVERY);
  assert.match(html, /Your discount/);
  // The amount is set large, with "off" small and italic beside it.
  assert.match(html, /font-size: 58px[^"]*">15%<span[^>]*font-style: italic[^>]*> off<\/span>/);
  // 15% of the $200 cart, stated in the masthead as well as the totals.
  assert.match(html, /That is \$30\.00 USD off this cart\./);
  // Stated once: the body no longer repeats the figure under the cart.
  assert.equal(html.match(/Your discount/g)?.length, 1);
});

test('a discount with no cart to measure it against still states the offer', () => {
  const html = renderPromoEmail({ ...RECOVERY, cart: null });
  assert.match(html, /font-size: 58px[^"]*">15%/);
  assert.match(html, /Applies to your whole order\./);
  assert.doesNotMatch(html, /off this cart/);
});

test('an explicit promoDetails wins over the generated line', () => {
  const html = renderPromoEmail({ ...RECOVERY, promoDetails: '15% off, this week only' });
  assert.match(html, /15% off, this week only/);
  assert.doesNotMatch(html, /off this cart/);
});

test('a bare code with no figure leaves the masthead as a masthead', () => {
  const html = renderPromoEmail({ ...RECOVERY, discount: null, promoDetails: 'A thank-you code' });
  assert.match(html, /COMEBACK15/);
  // The offer's own words move down beside the code, so nothing is lost.
  assert.match(html, /A thank-you code/);
  assert.match(html, /Your code/);
  // Nothing to hoist into the masthead when we do not know what the code is worth.
  assert.doesNotMatch(html, /font-size: 58px/);
  assert.doesNotMatch(html, /Your discount/);
});

test('a discount with no code states the offer without an empty code block', () => {
  const html = renderPromoEmail({ ...RECOVERY, promoCode: '', promoExpires: 'until 30 September' });
  assert.match(html, /Your discount/);
  assert.doesNotMatch(html, /Your code/);
  assert.doesNotMatch(html, /Enter at checkout/);
  // With no code block to carry it, the expiry rides in the masthead.
  assert.match(html, /until 30 September/);
});

test('a hostile payment link never reaches an href', () => {
  const html = renderPromoEmail({
    ...RECOVERY,
    checkout: { url: 'javascript:alert(document.cookie)' },
  });
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /Complete your order/);
});

test('cart line names are escaped, not injected', () => {
  const html = renderPromoEmail({
    ...RECOVERY,
    cart: { ...CART, items: [{ name: '<script>x</script>', quantity: 1, lineTotal: 1 }] },
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('the plain-text alternative carries the same figures and the bare URL', () => {
  const text = renderPromoEmailText(RECOVERY);
  assert.match(text, /Hi Sam,/);
  assert.match(text, /Code: COMEBACK15/);
  assert.match(text, /Subtotal: \$200\.00 USD/);
  assert.match(text, /Discount \(15% off\): -\$30\.00 USD/);
  assert.match(text, /Estimated total: \$170\.00 USD/);
  assert.match(text, /https:\/\/pay\.stealth\.health\/c\/abc/);
});

test('without a discount the cart shows a plain total', () => {
  const html = renderPromoEmail({ ...RECOVERY, discount: null, promoCode: '' });
  assert.match(html, /Total/);
  assert.doesNotMatch(html, /Estimated total/);
  assert.doesNotMatch(html, /COMEBACK15/);
});

// ---- The unchanged customer-desk path -------------------------------------

test('an outreach email with no extras renders as it always did', () => {
  const html = renderPromoEmail({
    firstName: 'Sam',
    subject: 'Hello',
    body: 'Hi {{first_name}}, just checking in.',
  });
  assert.match(html, /Hi Sam, just checking in\./);
  // No cart, no promo box, no button.
  assert.doesNotMatch(html, /Your cart/);
  assert.doesNotMatch(html, /Complete your order/);
  assert.doesNotMatch(html, /Your discount/);
  assert.doesNotMatch(html, /Your code/);
  // The chrome is still there: wordmark, card and footer.
  assert.match(html, /VYTA/);
  assert.match(html, /Canadian research peptides/);
});

test('the message is laid out in tables, so Outlook keeps the 600px measure', () => {
  const html = renderPromoEmail(RECOVERY);
  assert.match(html, /max-width: 600px/);
  // Every layout table is presentational — a screen reader should read the
  // message, not announce a grid.
  const tables = html.match(/<table[^>]*>/g) ?? [];
  assert.ok(tables.length > 0);
  for (const tag of tables) assert.match(tag, /role="presentation"/);
});

test('every template offers a usable starting point', () => {
  for (const t of [...PROMO_TEMPLATES, ...RECOVERY_TEMPLATES]) {
    assert.ok(t.key, 'template needs a key');
    assert.ok(t.label, `template ${t.key} needs a label`);
    // 'custom' is the blank one; everything else must come with words.
    if (t.key !== 'custom') {
      assert.ok(t.subject.trim(), `template ${t.key} needs a subject`);
      assert.ok(t.body.trim(), `template ${t.key} needs a body`);
    }
  }
});


// ---- zero is a missing figure, not a free order ---------------------------

test('an amount is only printable when it is a real, positive figure', () => {
  assert.equal(knownAmount(200), 200);
  assert.equal(knownAmount(0.01), 0.01);
  // PuraMass sends 0 cents for a hand-off it never priced.
  assert.equal(knownAmount(0), null);
  assert.equal(knownAmount(-5), null);
  assert.equal(knownAmount(null), null);
  assert.equal(knownAmount(undefined), null);
  assert.equal(knownAmount(NaN), null);
  assert.equal(knownAmount('200'), null);
});

const UNPRICED = {
  items: [{ name: 'P21 10mg (single vial)', quantity: 1, lineTotal: 0 }],
  subtotal: 0,
  currency: 'USD',
  reference: 'amc_unpriced',
};

test('a cart the ledger never priced shows the items and no totals at all', () => {
  const html = renderPromoEmail({ ...RECOVERY, cart: UNPRICED });
  // The basket is still restated — that is what makes the email recognisable.
  assert.match(html, /P21 10mg \(single vial\)/);
  assert.match(html, /amc_unpriced/);
  // But nothing claims a figure we do not have.
  assert.doesNotMatch(html, /\$0\.00/);
  assert.doesNotMatch(html, /Subtotal/);
  assert.doesNotMatch(html, /Estimated total/);
  assert.doesNotMatch(html, />Total</);
  // And no discount line, because there is nothing to take 15% off.
  assert.doesNotMatch(html, /Discount \(15% off\)/);
});

test('the offer is still made, just without a figure it cannot back up', () => {
  const html = renderPromoEmail({ ...RECOVERY, cart: UNPRICED });
  // The code and the headline offer survive — only the arithmetic goes.
  assert.match(html, /COMEBACK15/);
  assert.match(html, /15%/);
  assert.doesNotMatch(html, /off this cart/);
  assert.match(html, /Applies to your whole order\./);
});

test('the plain-text alternative drops the same figures', () => {
  const text = renderPromoEmailText({ ...RECOVERY, cart: UNPRICED });
  assert.match(text, /P21 10mg \(single vial\) ×1/);
  assert.doesNotMatch(text, /\$0\.00/);
  assert.doesNotMatch(text, /Subtotal:/);
  assert.doesNotMatch(text, /Total:/);
});

test('a total that is zero because the discount took it there is still shown', () => {
  // 100% off a $200 cart is a real answer, and the one the customer most wants.
  const html = renderPromoEmail({
    ...RECOVERY,
    discount: { type: 'percentage' as const, value: 100 },
  });
  assert.match(html, /Subtotal/);
  assert.match(html, /Estimated total/);
  assert.match(html, /\$0\.00 USD/);
});
