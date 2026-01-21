const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../supabase-client');
const mavianceClient = require('../maviance-client');

// Générer un token de sécurité
function generateSecureToken(userId) {
  const secret = process.env.TOKEN_SECRET;
  const timestamp = Date.now();
  const data = `${userId}:${timestamp}:${secret}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Vérifier un token
function verifyToken(userId, token) {
  const secret = process.env.TOKEN_SECRET;
  // Le token est valide pendant 1 heure
  for (let i = 0; i < 60; i++) {
    const timestamp = Date.now() - (i * 60 * 1000); // Vérifier chaque minute pendant 1h
    const data = `${userId}:${timestamp}:${secret}`;
    const expectedToken = crypto.createHash('sha256').update(data).digest('hex');
    if (expectedToken === token) {
      return true;
    }
  }
  return false;
}

// Route pour générer un token (appelée depuis l'app)
router.post('/generate-token', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID requis' });
    }
    
    const token = generateSecureToken(userId);
    res.json({ token });
    
  } catch (error) {
    console.error('Erreur génération token:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// Route pour initier un paiement
router.post('/initiate', async (req, res) => {
  try {
    const { userId, phone, amount, method, customerName, customerEmail } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    // Validation des données
    if (!userId || !phone || !amount || !method || !token) {
      return res.status(400).json({ error: 'Données manquantes' });
    }
    
    // Vérifier le token
    if (!verifyToken(userId, token)) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    
    // Vérifier l'utilisateur dans Supabase
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (userError || !user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Valider le numéro de téléphone
    const cleanedPhone = phone.replace(/\D/g, '');
    if (cleanedPhone.length < 9) {
      return res.status(400).json({ error: 'Numéro de téléphone invalide' });
    }
    
    // Appeler Maviance pour initier le paiement
    const paymentData = await mavianceClient.initiatePayment({
      amount: amount,
      serviceNumber: cleanedPhone,
      customerName: customerName || `${user.first_name} ${user.last_name}`,
      customerEmail: customerEmail || user.email,
      paymentMethod: method
    });
    
    // Enregistrer la transaction dans Supabase
    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        maviance_ptn: paymentData.ptn,
        amount: amount,
        status: 'PENDING',
        payment_method: method.toUpperCase(),
        phone_number: cleanedPhone,
        created_at: new Date()
      })
      .select()
      .single();
    
    if (transactionError) {
      console.error('Erreur création transaction:', transactionError);
      throw transactionError;
    }
    
    res.json({
      transactionId: transaction.id,
      ptn: paymentData.ptn,
      message: 'Paiement initié avec succès',
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Erreur initiation paiement:', error);
    res.status(500).json({ 
      error: 'Erreur lors de l\'initiation du paiement',
      details: error.message 
    });
  }
});

// Route pour vérifier le statut d'un paiement
router.get('/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }
    
    // Récupérer la transaction
    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('*, profiles(email, first_name, last_name)')
      .eq('id', transactionId)
      .single();
    
    if (transactionError || !transaction) {
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }
    
    // Vérifier le token
    if (!verifyToken(transaction.user_id, token)) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    
    // Si la transaction est déjà complétée
    if (transaction.status === 'COMPLETED') {
      return res.json({
        status: 'success',
        message: 'Paiement déjà confirmé',
        deepLink: `culturesnews://payment-success?userId=${transaction.user_id}`
      });
    }
    
    // Vérifier le statut auprès de Maviance
    const paymentInfo = await mavianceClient.getPaymentStatus(transaction.maviance_ptn);
    
    if (!paymentInfo.responseData || !Array.isArray(paymentInfo.responseData)) {
      return res.json({
        status: 'pending',
        message: 'En attente de la réponse du système de paiement'
      });
    }
    
    const mavianceData = paymentInfo.responseData[0];
    const status = mavianceData?.status;
    const errorCode = mavianceData?.errorCode;
    
    // Mettre à jour la transaction en fonction du statut
    if (status === 'SUCCESS') {
      // Mettre à jour le profil utilisateur
      await supabase
        .from('profiles')
        .update({ 
          is_premium: true,
          last_payment_date: new Date(),
          premium_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 an
        })
        .eq('id', transaction.user_id);
      
      // Mettre à jour la transaction
      await supabase
        .from('transactions')
        .update({ 
          status: 'COMPLETED',
          completed_at: new Date()
        })
        .eq('id', transactionId);
      
      return res.json({
        status: 'success',
        message: 'Paiement confirmé ! Accès premium activé.',
        deepLink: `culturesnews://payment-success?userId=${transaction.user_id}`
      });
      
    } else if (status === 'FAILED') {
      await supabase
        .from('transactions')
        .update({ 
          status: 'FAILED',
          error_code: errorCode,
          error_message: mavianceClient.getErrorMessage(errorCode)
        })
        .eq('id', transactionId);
      
      return res.json({
        status: 'failed',
        message: mavianceClient.getErrorMessage(errorCode),
        errorCode: errorCode
      });
      
    } else {
      // Statut PENDING ou autre
      return res.json({
        status: 'pending',
        message: 'En attente de confirmation sur votre téléphone'
      });
    }
    
  } catch (error) {
    console.error('Erreur vérification statut:', error);
    res.status(500).json({ 
      error: 'Erreur lors de la vérification du statut',
      details: error.message 
    });
  }
});

module.exports = router;