import { supabase } from '@/lib/supabase';
import type { Customer, Order, OrderItem } from '@/lib/supabase';
import { trackActivity, identifyVisitor } from '@/lib/customer/activity';

/**
 * Sign up a new customer using Supabase Auth
 */
export async function signUpCustomer(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  /** Customer consents to being contacted by an admin (claim workflow). */
  contactConsent?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  // Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
      },
    },
  });

  if (authError) {
    console.error('Auth signup error:', authError);
    return { success: false, error: authError.message };
  }

  if (!authData.user) {
    return { success: false, error: 'Failed to create account' };
  }

  // Create customer profile linked to auth user
  const { error: profileError } = await supabase.from('customers').insert({
    id: authData.user.id,
    email: data.email.toLowerCase(),
    first_name: data.firstName,
    last_name: data.lastName,
    phone: data.phone || null,
    contact_consent: data.contactConsent ?? false,
    website_accessed: 'aminocan',
  });

  if (profileError) {
    console.error('Profile creation error:', profileError);
    // Auth user created but profile failed - still return success
    // Profile can be created on first login
  }

  // Record the signup in the storefront funnel and hand this browser's
  // anonymous history to the new account. Both are best-effort.
  //
  // `identifyVisitor` needs a session, which `signUp` only returns when email
  // confirmation is off; when it is on, the same call runs from
  // CustomerContext on the first real sign-in instead. Either way the
  // attribution lands exactly once.
  void trackActivity({ type: 'signup' });
  void identifyVisitor();

  // Fire the admin "new registration" alert (best-effort — never blocks the
  // signup result). The endpoint is idempotent and only sends once per
  // customer, so it can't double-send.
  try {
    await fetch('/api/customer/register-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: authData.user.id }),
      keepalive: true,
    });
  } catch {
    /* alert is best-effort */
  }

  return { success: true };
}

/**
 * Sign in customer using Supabase Auth
 */
export async function signInCustomer(
  email: string,
  password: string
): Promise<{ success: boolean; customer?: Customer; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error('Auth signin error:', error);
    return { success: false, error: error.message };
  }

  if (!data.user) {
    return { success: false, error: 'Login failed' };
  }

  // Get customer profile
  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', data.user.id)
    .single();

  // If no profile exists, create one from auth metadata
  if (!customer) {
    const { data: newCustomer } = await supabase
      .from('customers')
      .insert({
        id: data.user.id,
        email: data.user.email?.toLowerCase(),
        first_name: data.user.user_metadata?.first_name || '',
        last_name: data.user.user_metadata?.last_name || '',
        website_accessed: 'aminocan',
      })
      .select()
      .single();

    return { success: true, customer: newCustomer || undefined };
  }

  // Update website_accessed on every login
  await supabase
    .from('customers')
    .update({ website_accessed: 'aminocan' })
    .eq('id', data.user.id);

  return { success: true, customer };
}

/**
 * Sign out customer
 */
export async function signOutCustomer(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Get current session
 */
export async function getCurrentSession(): Promise<Customer | null> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session?.user) return null;

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', session.user.id)
    .single();

  return customer;
}

/**
 * Get customer by ID
 */
export async function getCustomer(customerId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error) {
    console.error('Error fetching customer:', error);
    return null;
  }

  return data;
}

/**
 * Update customer profile
 */
export async function updateCustomer(
  customerId: string,
  updates: Partial<Omit<Customer, 'id' | 'created_at' | 'password_hash'>>
): Promise<{ success: boolean; customer?: Customer; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('customers')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      console.error('Error updating customer:', error);
      return { success: false, error: 'Failed to update profile' };
    }

    return { success: true, customer: data };
  } catch (error) {
    console.error('Error in updateCustomer:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}

/**
 * A customer-facing order that may be backed by a real `orders` row or by a
 * paid PuraMass (Stealth Health) invoice surfaced as an order. The extra fields
 * are read defensively by the account UI via `(order as any)`.
 */
export type CustomerOrder = Order & {
  source?: string | null;
  currency?: string | null;
  subtotal?: number | null;
  shipping_cost?: number | null;
};

/**
 * Map a paid PuraMass invoice (+ its line items) into the customer-facing order
 * shape so it renders alongside native orders in /account and /dashboard.
 * PuraMass owns payment/shipping/taxes, so address/tracking/crypto are absent.
 */
function mapInvoiceToOrder(inv: any, lineItems: any[] = []): CustomerOrder {
  const items = (lineItems ?? []).map((li) => ({
    name: li.description ?? 'Item',
    quantity: Number(li.qty ?? 1),
    price: Number(li.unit_price ?? 0),
  }));
  return {
    id: inv.id,
    customer_id: inv.customer_id ?? null,
    order_number: inv.invoice_number,
    items,
    total: Number(inv.total ?? 0),
    email: inv.customer_email ?? null,
    shipping_address: null,
    crypto: null as any,
    // Paid on the hosted page; "processing" is the closest customer-facing
    // status while fulfilment is arranged (a cancelled invoice stays cancelled).
    status: inv.status === 'cancelled' ? 'cancelled' : 'processing',
    payment_address: null,
    payment_amount_expected: null,
    payment_amount_received: null,
    payment_tx_hash: null,
    payment_derivation_index: null,
    payment_confirmations: 0,
    payment_confirmed_at: null,
    payment_expires_at: null,
    referral_code: null,
    tracking_number: null,
    notes: inv.notes ?? null,
    created_at: inv.created_at,
    updated_at: inv.updated_at ?? inv.created_at,
    source: 'stealth_health',
    currency: inv.currency ?? 'USD',
    subtotal: inv.subtotal != null ? Number(inv.subtotal) : null,
    shipping_cost: inv.shipping_cost != null ? Number(inv.shipping_cost) : null,
  };
}

/**
 * Get all orders for a customer — native `orders` plus paid PuraMass invoices
 * (source = 'stealth_health') linked to this customer — newest first.
 */
export async function getCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  const [ordersRes, invoicesRes] = await Promise.all([
    supabase
      .from('orders')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false }),
    // Paid PuraMass sales live in `invoices` (the fulfilment record). Degrades
    // to no extra rows if the source column/table isn't present.
    supabase
      .from('invoices')
      .select('*')
      .eq('customer_id', customerId)
      .eq('source', 'stealth_health')
      // Unpaid hand-offs (still at checkout, or lapsed) are not orders yet.
      .not('status', 'in', '(draft,pending_payment,expired)')
      .order('created_at', { ascending: false }),
  ]);

  if (ordersRes.error) {
    console.error('Error fetching orders:', ordersRes.error);
  }
  if (invoicesRes.error) {
    // Non-fatal — just show native orders.
    console.error('Error fetching PuraMass invoices:', invoicesRes.error);
  }

  const orders = (ordersRes.data ?? []) as CustomerOrder[];
  const puramass = (invoicesRes.data ?? []).map((inv) => mapInvoiceToOrder(inv));

  return [...orders, ...puramass].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * Get an order with its items. Resolves a native `orders` row first; falls back
 * to a paid PuraMass invoice surfaced as an order (with its invoice line items).
 */
export async function getOrderWithItems(
  orderId: string
): Promise<{ order: CustomerOrder; items: (OrderItem & { product_name?: string; product_strength?: string })[] } | null> {
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (order) {
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('Error fetching order items:', itemsError);
      return { order: order as CustomerOrder, items: [] };
    }
    return { order: order as CustomerOrder, items: items || [] };
  }

  // Not a native order — try a paid PuraMass invoice.
  const { data: inv } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', orderId)
    .eq('source', 'stealth_health')
    .not('status', 'in', '(draft,pending_payment,expired)')
    .maybeSingle();

  if (!inv) return null;

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', orderId);

  const mapped = mapInvoiceToOrder(inv, lineItems ?? []);
  const items = (lineItems ?? []).map((li: any, i: number) => ({
    id: li.id ?? String(i),
    order_id: orderId,
    product_name: li.description ?? `Item ${i + 1}`,
    product_id: null,
    quantity: Number(li.qty ?? 1),
    price_at_time: Number(li.unit_price ?? 0),
    strength: null,
    created_at: li.created_at ?? mapped.created_at,
  })) as (OrderItem & { product_name?: string; product_strength?: string })[];

  return { order: mapped, items };
}

/**
 * Generate a unique order number
 */
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `NP-${timestamp}-${random}`;
}

/**
 * Create a new order from cart
 */
export async function createOrder(data: {
  customerId: string;
  items: Array<{ id: string; name: string; price: number; quantity: number; strength: string }>;
  totalAmount: number;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
  referralCode?: string;
}): Promise<{ success: boolean; order?: Order; error?: string }> {
  try {
    const orderNumber = generateOrderNumber();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: data.customerId,
        order_number: orderNumber,
        status: 'pending',
        total: data.totalAmount,
        items: data.items.map(i => ({ name: i.name || '', quantity: i.quantity, price: i.price })),
        crypto: 'btc' as const,
        shipping_address: { firstName: '', lastName: '', address: data.shippingAddress, city: data.shippingCity, state: data.shippingState, postalCode: data.shippingPostalCode, country: data.shippingCountry },
        referral_code: data.referralCode || null,
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error('Error creating order:', orderError);
      return { success: false, error: 'Failed to create order' };
    }

    const orderItems = data.items.map((item) => ({
      order_id: order.id,
      product_name: item.name || 'Product',
      product_id: item.id,
      quantity: item.quantity,
      price_at_time: item.price,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);

    if (itemsError) {
      console.error('Error creating order items:', itemsError);
    }

    // Create commission if referral code
    if (data.referralCode) {
      const { data: refCode } = await supabase
        .from('referral_codes')
        .select('id, affiliate_id')
        .eq('code', data.referralCode.toUpperCase())
        .eq('active', true)
        .single();

      if (refCode) {
        const commissionAmount = data.totalAmount * 0.1;
        await supabase.from('commissions').insert({
          affiliate_id: refCode.affiliate_id,
          order_id: order.id,
          referral_code_id: refCode.id,
          amount: commissionAmount,
          order_total: data.totalAmount,
          commission_rate: 10,
          status: 'pending',
        });
      }
    }

    return { success: true, order };
  } catch (error) {
    console.error('Error in createOrder:', error);
    return { success: false, error: 'An unexpected error occurred' };
  }
}
