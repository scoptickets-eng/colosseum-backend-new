// ============================================================
// CREATE PAYMENT INTENT — api/create-payment-intent.js
// El front llama esto antes de mostrar el formulario de Stripe
// ============================================================

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    ticket_type,
    qty_adults,
    qty_children,
    qty_infants,
    visit_date,
    time_slot,
    customer_name,
    email,
    amount  // en euros (ej: 27.00)
  } = req.body;

  // Validación básica
  if (!ticket_type || !email || !amount || !visit_date || !time_slot) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // convertir a centavos
      currency: 'eur',
      metadata: {
        // Estos datos viajan con el pago y llegan al webhook
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
      description: `Colosseum Tickets — ${ticket_type} — ${visit_date} ${time_slot}`
    });

    return res.status(200).json({
      clientSecret: paymentIntent.client_secret
    });

  } catch (err) {
    console.error('Error creando PaymentIntent:', err);
    return res.status(500).json({ error: err.message });
  }
}
