const express = require('express');
const router = express.Router();
const supabase = require('../supabase-client');
const crypto = require('crypto');

// Middleware pour vérifier la signature Maviance (optionnel)
const verifyMavianceSignature = (req, res, next) => {
  // Si Maviance envoie une signature, la vérifier ici
  const signature = req.headers['x-maviance-signature'];
  const secret = process.env.MAVIANCE_WEBHOOK_SECRET;
  
  if (secret && signature) {
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      console.error('❌ Signature webhook invalide');
      return res.status(401).json({ error: 'Signature invalide' });
    }
  }
  
  next();
};

// Webhook pour recevoir les notifications de Maviance
router.post('/maviance', verifyMavianceSignature, async (req, res) => {
  try {
    const { ptn, status, amount, phone, timestamp, errorCode, errorMessage } = req.body;
    
    console.log('📩 Webhook Maviance reçu:', { 
      ptn, 
      status, 
      amount, 
      phone,
      timestamp,
      errorCode,
      errorMessage 
    });
    
    // Valider les données requises
    if (!ptn || !status) {
      console.error('Données webhook incomplètes:', req.body);
      return res.status(400).json({ error: 'Données incomplètes' });
    }
    
    // Trouver la transaction correspondante
    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('*')
      .eq('maviance_ptn', ptn)
      .single();
    
    if (transactionError || !transaction) {
      console.error('❌ Transaction non trouvée pour ptn:', ptn);
      return res.status(404).json({ 
        error: 'Transaction non trouvée',
        ptn: ptn 
      });
    }
    
    console.log('📊 Transaction trouvée:', {
      id: transaction.id,
      userId: transaction.user_id,
      currentStatus: transaction.status
    });
    
    // Si la transaction est déjà finalisée, ne rien faire
    if (transaction.status === 'COMPLETED' || transaction.status === 'FAILED') {
      console.log(`ℹ️ Transaction ${transaction.id} déjà ${transaction.status}`);
      return res.status(200).json({ 
        received: true,
        message: `Transaction déjà ${transaction.status}` 
      });
    }
    
    // Mettre à jour la transaction
    if (status === 'SUCCESS') {
      // Mettre à jour le profil utilisateur
      const premiumExpiresAt = new Date();
      premiumExpiresAt.setFullYear(premiumExpiresAt.getFullYear() + 1); // 1 an
      
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          is_premium: true,
          last_payment_date: new Date(),
          premium_expires_at: premiumExpiresAt,
          updated_at: new Date()
        })
        .eq('id', transaction.user_id);
      
      if (updateError) {
        console.error('❌ Erreur mise à jour profil:', updateError);
      } else {
        console.log('✅ Profil mis à jour pour utilisateur:', transaction.user_id);
      }
      
      // Mettre à jour la transaction
      const { error: transactionUpdateError } = await supabase
        .from('transactions')
        .update({ 
          status: 'COMPLETED',
          completed_at: new Date(),
          webhook_received: true,
          webhook_received_at: new Date()
        })
        .eq('id', transaction.id);
      
      if (transactionUpdateError) {
        console.error('❌ Erreur mise à jour transaction:', transactionUpdateError);
      } else {
        console.log('✅ Transaction mise à jour:', transaction.id);
      }
      
      console.log('🎉 Transaction complétée via webhook:', transaction.id);
      
    } else if (status === 'FAILED') {
      const { error: transactionUpdateError } = await supabase
        .from('transactions')
        .update({ 
          status: 'FAILED',
          error_code: errorCode,
          error_message: errorMessage || 'Paiement échoué',
          completed_at: new Date(),
          webhook_received: true,
          webhook_received_at: new Date()
        })
        .eq('id', transaction.id);
      
      if (transactionUpdateError) {
        console.error('❌ Erreur mise à jour transaction échouée:', transactionUpdateError);
      } else {
        console.log('❌ Transaction marquée comme échouée:', transaction.id);
      }
    } else {
      // Statut PENDING ou autre - mettre à jour mais pas finaliser
      const { error: transactionUpdateError } = await supabase
        .from('transactions')
        .update({ 
          status: 'PENDING',
          webhook_received: true,
          webhook_received_at: new Date(),
          last_webhook_status: status
        })
        .eq('id', transaction.id);
      
      console.log(`ℹ️ Transaction ${transaction.id} mise à jour avec statut: ${status}`);
    }
    
    // Répondre à Maviance
    res.status(200).json({ 
      received: true,
      processed: true,
      transactionId: transaction.id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur webhook Maviance:', {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    
    res.status(500).json({ 
      error: 'Erreur interne',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Webhook pour tester la réception
router.post('/test', async (req, res) => {
  console.log('🧪 Webhook test reçu:', req.body);
  res.status(200).json({ 
    message: 'Webhook test successful',
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// Route pour vérifier l'état du webhook
router.get('/status', async (req, res) => {
  res.json({
    status: 'active',
    webhooks: {
      maviance: '/webhooks/maviance (POST)',
      test: '/webhooks/test (POST)'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;