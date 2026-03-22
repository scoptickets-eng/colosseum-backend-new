const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Leer el raw body manualmente
  const rawBody = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: 'Webhook error: ' + err.message });
  }

  if (event.type !== 'payment_intent.succeeded') {
    return res.status(200).json({ received: true });
  }

  const paymentIntent = event.data.object;
  const meta = paymentIntent.metadata;

  try {
    const { data: existing } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_id', paymentIntent.id)
      .single();

    if (existing) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    let customerId;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', meta.email)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert({
          email: meta.email,
          name: meta.customer_name
        })
        .select('id')
        .single();
      customerId = newCustomer.id;
    }

    await supabase.from('orders').insert({
      customer_id: customerId,
      email: meta.email,
      ticket_type: meta.ticket_type,
      qty_adults: parseInt(meta.qty_adults),
      qty_children: parseInt(meta.qty_children || 0),
      qty_infants: parseInt(meta.qty_infants || 0),
      visit_date: meta.visit_date.split('/').reverse().join('-'),
      time_slot: meta.time_slot,
      amount_total: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      status: 'paid',
      stripe_payment_id: paymentIntent.id
    });

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
