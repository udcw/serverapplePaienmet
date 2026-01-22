const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../supabase-client');
const mavianceClient = require('../maviance-client');

// Générer un token de sécurité avec expiration
function generateSecureToken(userId) {
  const secret = process.env.TOKEN_SECRET || 'cultures-news-secret-key-2024';
  const timestamp = Date.now();
  const expiry = timestamp + (60 * 60 * 1000); // 1 heure
  const data = `${userId}:${timestamp}:${expiry}:${secret}`;
  return {
    token: crypto.createHash('sha256').update(data).digest('hex'),
    expiresAt: expiry
  };
}

// Vérifier un token
function verifyToken(userId, token) {
  const secret = process.env.TOKEN_SECRET || 'cultures-news-secret-key-2024';
  // Le token est valide pendant 1 heure
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 heure
  
  for (let i = 0; i <= 60; i++) {
    const timestamp = now - (i * 60 * 1000); // Vérifier chaque minute
    const expiry = timestamp + maxAge;
    
    if (expiry < now) continue; // Token expiré
    
    const data = `${userId}:${timestamp}:${expiry}:${secret}`;
    const expectedToken = crypto.createHash('sha256').update(data).digest('hex');
    
    if (expectedToken === token) {
      return true;
    }
  }
  return false;
}

// Route de test de connexion
router.get('/test-connection', async (req, res) => {
  try {
    res.json({ 
      status: 'success', 
      message: 'API Payment is working',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Test failed',
      details: error.message 
    });
  }
});

// Route pour générer un token (appelée depuis l'app)
router.post('/generate-token', async (req, res) => {
  try {
    console.log('📱 Requête generate-token:', req.body);
    
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ 
        error: 'User ID requis',
        code: 'MISSING_USER_ID' 
      });
    }
    
    const tokenData = generateSecureToken(userId);
    
    res.json({ 
      success: true,
      token: tokenData.token,
      expiresAt: tokenData.expiresAt,
      userId: userId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur génération token:', error);
    res.status(500).json({ 
      error: 'Erreur interne',
      code: 'TOKEN_GENERATION_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Route pour vérifier le statut premium d'un utilisateur
router.get('/check-premium/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('🔍 Vérification premium pour:', userId);
    
    const { data: user, error } = await supabase
      .from('profiles')
      .select('is_premium, premium_expires_at, last_payment_date')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('Erreur Supabase:', error);
      return res.status(404).json({ 
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND' 
      });
    }
    
    const isPremium = user.is_premium || false;
    const expiresAt = user.premium_expires_at;
    const now = new Date();
    const isExpired = expiresAt ? new Date(expiresAt) < now : false;
    
    res.json({
      success: true,
      isPremium: isPremium && !isExpired,
      expiresAt: expiresAt,
      lastPayment: user.last_payment_date,
      timestamp: now.toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur vérification premium:', error);
    res.status(500).json({ 
      error: 'Erreur interne',
      code: 'PREMIUM_CHECK_ERROR'
    });
  }
});

// Route pour initier un paiement
router.post('/initiate', async (req, res) => {
  try {
    console.log('💰 Initiation paiement:', req.body);
    
    const { userId, phone, amount, method, customerName, customerEmail } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    // Validation des données
    if (!userId || !phone || !amount || !method || !token) {
      return res.status(400).json({ 
        error: 'Données manquantes',
        required: ['userId', 'phone', 'amount', 'method', 'token'],
        received: { userId, phone, amount, method, hasToken: !!token }
      });
    }
    
    // Vérifier le token
    if (!verifyToken(userId, token)) {
      return res.status(401).json({ 
        error: 'Token invalide ou expiré',
        code: 'INVALID_TOKEN' 
      });
    }
    
    // Vérifier l'utilisateur dans Supabase
    const { data: user, error: userError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (userError || !user) {
      console.error('Utilisateur non trouvé:', userId);
      return res.status(404).json({ 
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND' 
      });
    }
    
    // Valider le numéro de téléphone
    const cleanedPhone = phone.replace(/\D/g, '');
    if (cleanedPhone.length < 9) {
      return res.status(400).json({ 
        error: 'Numéro de téléphone invalide',
        phone: phone,
        cleaned: cleanedPhone,
        requiredLength: 9
      });
    }
    
    // Vérifier si l'utilisateur est déjà premium
    if (user.is_premium) {
      const expiresAt = new Date(user.premium_expires_at);
      const now = new Date();
      
      if (expiresAt > now) {
        return res.status(400).json({
          error: 'Utilisateur déjà premium',
          expiresAt: expiresAt,
          message: 'Votre abonnement premium est actif jusqu\'au ' + expiresAt.toLocaleDateString()
        });
      }
    }
    
    // Appeler Maviance pour initier le paiement
    console.log('📞 Appel Maviance pour:', {
      amount,
      phone: cleanedPhone,
      method
    });
    
    const paymentData = await mavianceClient.initiatePayment({
      amount: amount,
      serviceNumber: cleanedPhone,
      customerName: customerName || `${user.first_name} ${user.last_name}`,
      customerEmail: customerEmail || user.email,
      paymentMethod: method
    });
    
    console.log('✅ Réponse Maviance:', paymentData);
    
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
        customer_name: customerName || `${user.first_name} ${user.last_name}`,
        customer_email: customerEmail || user.email,
        created_at: new Date()
      })
      .select()
      .single();
    
    if (transactionError) {
      console.error('❌ Erreur création transaction:', transactionError);
      throw transactionError;
    }
    
    console.log('💾 Transaction créée:', transaction.id);
    
    res.json({
      success: true,
      transactionId: transaction.id,
      ptn: paymentData.ptn,
      message: 'Paiement initié avec succès',
      timestamp: new Date().toISOString(),
      nextSteps: {
        checkStatus: `/api/payment/status/${transaction.id}`,
        webhook: `/webhooks/maviance`
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur initiation paiement:', {
      message: error.message,
      stack: error.stack,
      body: req.body
    });
    
    res.status(500).json({ 
      error: 'Erreur lors de l\'initiation du paiement',
      code: 'PAYMENT_INIT_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Veuillez réessayer plus tard'
    });
  }
});

// Route pour vérifier le statut d'un paiement
router.get('/status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    console.log('🔍 Vérification statut transaction:', transactionId);
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Token manquant',
        code: 'MISSING_TOKEN' 
      });
    }
    
    // Récupérer la transaction
    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('*, profiles(email, first_name, last_name)')
      .eq('id', transactionId)
      .single();
    
    if (transactionError || !transaction) {
      console.error('Transaction non trouvée:', transactionId);
      return res.status(404).json({ 
        error: 'Transaction non trouvée',
        code: 'TRANSACTION_NOT_FOUND' 
      });
    }
    
    // Vérifier le token
    if (!verifyToken(transaction.user_id, token)) {
      return res.status(401).json({ 
        error: 'Token invalide',
        code: 'INVALID_TOKEN' 
      });
    }
    
    console.log('📊 Transaction trouvée:', {
      id: transaction.id,
      status: transaction.status,
      userId: transaction.user_id
    });
    
    // Si la transaction est déjà complétée
    if (transaction.status === 'COMPLETED') {
      return res.json({
        status: 'success',
        success: true,
        message: 'Paiement déjà confirmé',
        transactionId: transaction.id,
        deepLink: `culturesnews://payment-success?userId=${transaction.user_id}&transactionId=${transaction.id}`,
        webLink: `/payment-success/${transaction.user_id}`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Vérifier le statut auprès de Maviance
    console.log('📞 Appel Maviance pour statut:', transaction.maviance_ptn);
    const paymentInfo = await mavianceClient.getPaymentStatus(transaction.maviance_ptn);
    
    console.log('📋 Réponse Maviance statut:', paymentInfo);
    
    if (!paymentInfo || !paymentInfo.responseData || !Array.isArray(paymentInfo.responseData)) {
      return res.json({
        status: 'pending',
        success: false,
        message: 'En attente de la réponse du système de paiement',
        transactionId: transaction.id,
        lastCheck: new Date().toISOString()
      });
    }
    
    const mavianceData = paymentInfo.responseData[0];
    const status = mavianceData?.status;
    const errorCode = mavianceData?.errorCode;
    
    console.log('📈 Statut Maviance:', { status, errorCode });
    
    // Mettre à jour la transaction en fonction du statut
    if (status === 'SUCCESS') {
      // Mettre à jour le profil utilisateur
      const premiumExpiresAt = new Date();
      premiumExpiresAt.setFullYear(premiumExpiresAt.getFullYear() + 1); // 1 an
      
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          is_premium: true,
          last_payment_date: new Date(),
          premium_expires_at: premiumExpiresAt
        })
        .eq('id', transaction.user_id);
      
      if (updateError) {
        console.error('❌ Erreur mise à jour profil:', updateError);
      }
      
      // Mettre à jour la transaction
      const { error: transactionUpdateError } = await supabase
        .from('transactions')
        .update({ 
          status: 'COMPLETED',
          completed_at: new Date(),
          error_code: null,
          error_message: null
        })
        .eq('id', transactionId);
      
      if (transactionUpdateError) {
        console.error('❌ Erreur mise à jour transaction:', transactionUpdateError);
      }
      
      console.log('✅ Paiement confirmé pour utilisateur:', transaction.user_id);
      
      return res.json({
        status: 'success',
        success: true,
        message: 'Paiement confirmé ! Accès premium activé pour 1 an.',
        transactionId: transaction.id,
        userId: transaction.user_id,
        deepLink: `culturesnews://payment-success?userId=${transaction.user_id}&transactionId=${transaction.id}`,
        webLink: `/payment-success/${transaction.user_id}`,
        timestamp: new Date().toISOString()
      });
      
    } else if (status === 'FAILED') {
      const errorMessage = mavianceClient.getErrorMessage(errorCode);
      
      await supabase
        .from('transactions')
        .update({ 
          status: 'FAILED',
          error_code: errorCode,
          error_message: errorMessage,
          completed_at: new Date()
        })
        .eq('id', transactionId);
      
      return res.json({
        status: 'failed',
        success: false,
        message: errorMessage,
        errorCode: errorCode,
        transactionId: transaction.id,
        timestamp: new Date().toISOString()
      });
      
    } else {
      // Statut PENDING ou autre
      return res.json({
        status: 'pending',
        success: false,
        message: 'En attente de confirmation sur votre téléphone',
        transactionId: transaction.id,
        lastCheck: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur vérification statut:', {
      message: error.message,
      stack: error.stack,
      transactionId: req.params.transactionId
    });
    
    res.status(500).json({ 
      error: 'Erreur lors de la vérification du statut',
      code: 'STATUS_CHECK_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

// Route pour obtenir l'historique des transactions d'un utilisateur
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token || !verifyToken(userId, token)) {
      return res.status(401).json({ error: 'Token invalide' });
    }
    
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    res.json({
      success: true,
      transactions: transactions || [],
      count: transactions?.length || 0,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Erreur historique transactions:', error);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

module.exports = router;