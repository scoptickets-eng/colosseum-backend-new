const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { ticket_type, qty_adults, qty_children, qty_infants, visit_date, time_slot, customer_name, email, amount } = req.body;

  if (!ticket_type || !email || !amount || !visit_date || !time_slot) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      metadata: {
        ticket_type: ticket_type,
        qty_adults: String(qty_adults),
        qty_children: String(qty_children || 0),
        qty_infants: String(qty_infants || 0),
        visit_date: visit_date,
        time_slot: time_slot,
        customer_name: customer_name,
        email: email
      },
      receipt_email: email
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
