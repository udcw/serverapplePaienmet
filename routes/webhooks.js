const express = require('express');
const router = express.Router();
const supabase = require('../supabase-client');

// Webhook pour recevoir les notifications de Maviance
router.post('/maviance', async (req, res) => {
  try {
    const { ptn, status, amount, phone, timestamp } = req.body;
    
    console.log('Webhook Maviance reçu:', { ptn, status, amount, phone });
    
    // Valider la signature si nécessaire
    // (Maviance peut envoyer une signature HMAC pour sécurité)
    
    // Trouver la transaction correspondante
    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('*')
      .eq('maviance_ptn', ptn)
      .single();
    
    if (transactionError || !transaction) {
      console.error('Transaction non trouvée pour ptn:', ptn);
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }
    
    // Mettre à jour la transaction
    if (status === 'SUCCESS') {
      // Mettre à jour le profil utilisateur
      await supabase
        .from('profiles')
        .update({ 
          is_premium: true,
          last_payment_date: new Date(),
          premium_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        })
        .eq('id', transaction.user_id);
      
      // Mettre à jour la transaction
      await supabase
        .from('transactions')
        .update({ 
          status: 'COMPLETED',
          completed_at: new Date(),
          webhook_received: true
        })
        .eq('id', transaction.id);
      
      console.log('Transaction complétée via webhook:', transaction.id);
      
    } else if (status === 'FAILED') {
      await supabase
        .from('transactions')
        .update({ 
          status: 'FAILED',
          webhook_received: true
        })
        .eq('id', transaction.id);
    }
    
    // Répondre à Maviance
    res.status(200).json({ received: true });
    
  } catch (error) {
    console.error('Erreur webhook Maviance:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Webhook pour Stripe (si vous ajoutez d'autres méthodes plus tard)
router.post('/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  // Implémentation pour Stripe
  res.status(200).send('OK');
});

module.exports = router;