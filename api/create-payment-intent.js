const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const {
    ticket_type,
    qty_adults,
    qty_children,
    qty_infants,
    visit_date,
    time_slot,
    customer_name,
    email,
    amount
  } = req.body;

  if (!ticket_type || !email || !amount || !visit_date || !time_slot) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'eur',
      metadata: {
        ticket_type,
        qty_adults: String(qty_adults),
        qty_children: String(qty_children || 0),
        qty_infants: String(qty_infants || 0),
        visit_date,
        time_slot,
        customer_name,
        email
      },
      receipt_email: email,
      description: 'Colosseum Tickets - ' + ticket_type + ' - ' + visit_date + ' ' + time_slot ⁠
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
