// ============================================================
// STRIPE WEBHOOK → SUPABASE
// Colosseum Tickets — Backend Handler
//
// Deploy en: Vercel (api/webhook.js) o Railway
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend'; // opcional: para enviar email con QR
import { randomUUID } from 'crypto';

// ── Credenciales (usar variables de entorno, nunca hardcodear) ──
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role: bypasea RLS
);
const resend = new Resend(process.env.RESEND_API_KEY); // quitar si no usás email

// ── Endpoint principal ──────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Verificar firma de Stripe (seguridad crítica)
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,          // body debe ser raw buffer (ver config abajo)
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // 2. Solo procesar pagos exitosos
  if (event.type !== 'payment_intent.succeeded') {
    return res.status(200).json({ received: true });
  }

  const paymentIntent = event.data.object;
  const meta = paymentIntent.metadata; // datos del pedido guardados al crear el PaymentIntent

  try {
    // 3. Verificar que la orden no fue procesada antes (idempotencia)
    const { data: existing } = await supabase
      .from('orders')
      .select('id')
      .eq('stripe_payment_id', paymentIntent.id)
      .single();

    if (existing) {
      console.log('Orden ya procesada:', paymentIntent.id);
      return res.status(200).json({ received: true, duplicate: true });
    }

    // 4. Crear customer si no existe
    let customerId;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', meta.email)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          id: randomUUID(),
          email: meta.email,
          name: meta.customer_name,
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (customerError) throw customerError;
      customerId = newCustomer.id;
    }

    // 5. Insertar orden
    const orderId = randomUUID();
    const { error: orderError } = await supabase
      .from('orders')
      .insert({
        id: orderId,
        customer_id: customerId,
        email: meta.email,
        ticket_type: meta.ticket_type,       // 'standard' | 'full' | 'vip'
        qty_adults: parseInt(meta.qty_adults),
        qty_children: parseInt(meta.qty_children || 0),
        qty_infants: parseInt(meta.qty_infants || 0),
        visit_date: meta.visit_date,
        time_slot: meta.time_slot,
        amount_total: paymentIntent.amount / 100, // Stripe usa centavos
        currency: paymentIntent.currency,
        status: 'paid',
        stripe_payment_id: paymentIntent.id,
        created_at: new Date().toISOString()
      });

    if (orderError) throw orderError;

    // 6. Generar tickets individuales (uno por persona adulta)
    const ticketInserts = [];
    const totalTickets = parseInt(meta.qty_adults) + parseInt(meta.qty_children || 0);

    for (let i = 0; i < totalTickets; i++) {
      ticketInserts.push({
        id: randomUUID(),
        order_id: orderId,
        qr_code: `COL-${orderId.split('-')[0].toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
        ticket_index: i + 1,
        used: false,
        created_at: new Date().toISOString()
      });
    }

    const { error: ticketsError } = await supabase
      .from('tickets')
      .insert(ticketInserts);

    if (ticketsError) throw ticketsError;

    // 7. Actualizar disponibilidad (restar cupos)
    const { data: slot, error: slotFetchError } = await supabase
      .from('availability')
      .select('booked, capacity')
      .eq('date', meta.visit_date)
      .eq('time_slot', meta.time_slot)
      .eq('ticket_type', meta.ticket_type)
      .single();

    if (!slotFetchError && slot) {
      await supabase
        .from('availability')
        .update({ booked: slot.booked + totalTickets })
        .eq('date', meta.visit_date)
        .eq('time_slot', meta.time_slot)
        .eq('ticket_type', meta.ticket_type);
    }

    // 8. Enviar email de confirmación (requiere Resend — quitar si no se usa)
    if (process.env.RESEND_API_KEY) {
      const ticketList = ticketInserts
        .map(t => `<li style="margin:4px 0;font-family:monospace">${t.qr_code}</li>`)
        .join('');

      await resend.emails.send({
        from: 'Colosseum Tickets <tickets@tudominio.com>',
        to: meta.email,
        subject: `✦ Tu entrada al Coliseo — ${meta.visit_date} ${meta.time_slot}`,
        html: `
          <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#2c1810">
            <div style="background:#2c1810;padding:32px;text-align:center">
              <h1 style="font-family:Georgia,serif;color:#c9a84c;margin:0;font-size:28px;letter-spacing:3px">COLOSSEUM</h1>
              <p style="color:#c8b89a;margin:8px 0 0;font-style:italic">Amphitheatrum Flavium</p>
            </div>
            <div style="padding:32px;background:#f5ead6">
              <h2 style="color:#2c1810;margin-top:0">¡Reserva confirmada!</h2>
              <p>Hola <strong>${meta.customer_name}</strong>,</p>
              <p>Tu visita al Coliseo de Roma está confirmada. A continuación encontrás los códigos de tus entradas.</p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0">
                <tr><td style="padding:8px 0;border-bottom:1px solid #c8b89a;color:#8b7355">Tipo de entrada</td><td style="padding:8px 0;border-bottom:1px solid #c8b89a;font-weight:bold">${getTicketName(meta.ticket_type)}</td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid #c8b89a;color:#8b7355">Fecha</td><td style="padding:8px 0;border-bottom:1px solid #c8b89a;font-weight:bold">${meta.visit_date}</td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid #c8b89a;color:#8b7355">Horario</td><td style="padding:8px 0;border-bottom:1px solid #c8b89a;font-weight:bold">${meta.time_slot}</td></tr>
                <tr><td style="padding:8px 0;border-bottom:1px solid #c8b89a;color:#8b7355">Adultos</td><td style="padding:8px 0;border-bottom:1px solid #c8b89a;font-weight:bold">${meta.qty_adults}</td></tr>
                <tr><td style="padding:8px 0;color:#8b7355">Total pagado</td><td style="padding:8px 0;font-weight:bold;color:#c9a84c">€${(paymentIntent.amount / 100).toFixed(2)}</td></tr>
              </table>
              <div style="background:#2c1810;padding:20px;margin:20px 0">
                <p style="color:#c9a84c;font-family:Georgia,serif;margin:0 0 12px;font-size:12px;letter-spacing:2px">CÓDIGOS QR DE ENTRADA</p>
                <ul style="color:#f5ead6;margin:0;padding-left:20px">${ticketList}</ul>
              </div>
              <p style="font-size:13px;color:#8b7355">Mostrá estos códigos en la entrada del Coliseo. Llegá 10 minutos antes de tu horario.</p>
            </div>
            <div style="background:#2c1810;padding:16px;text-align:center">
              <p style="color:#8b7355;font-size:12px;margin:0">Piazza del Colosseo, 1 · 00184 Roma · Italia</p>
            </div>
          </div>
        `
      });
    }

    console.log(`✓ Orden ${orderId} procesada correctamente`);
    return res.status(200).json({ received: true, orderId });

  } catch (err) {
    console.error('Error procesando webhook:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Helper ──────────────────────────────────────────────────
function getTicketName(type) {
  const names = {
    standard: 'Entrada Clásica',
    full: 'Coliseo + Arena Floor',
    vip: 'Arena + Tour Guiado'
  };
  return names[type] || type;
}

// ── Configuración para Vercel (raw body) ────────────────────
// Crear también: api/webhook.js con este export config:
export const config = {
  api: {
    bodyParser: false // CRÍTICO: Stripe necesita el body sin parsear
  }
};
