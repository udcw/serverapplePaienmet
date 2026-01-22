const axios = require('axios');

class MavianceClient {
  constructor() {
    this.baseURL = process.env.MAVIANCE_BASE_URL || 'https://api.sandbox.maviance.com/v2';
    this.clientId = process.env.MAVIANCE_CLIENT_ID;
    this.clientSecret = process.env.MAVIANCE_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async authenticate() {
    try {
      console.log('🔑 Authentification Maviance...');
      
      const response = await axios.post(`${this.baseURL}/oauth/v2/token`, null, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      if (!response.data.access_token) {
        throw new Error('Token non reçu dans la réponse');
      }
      
      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      this.retryCount = 0;
      
      console.log('✅ Authentification Maviance réussie');
      console.log(`   Token expire dans: ${response.data.expires_in} secondes`);
      
      return this.accessToken;
    } catch (error) {
      this.retryCount++;
      console.error('❌ Erreur authentification Maviance:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
        retryCount: this.retryCount
      });
      
      if (this.retryCount <= this.maxRetries) {
        console.log(`🔄 Nouvelle tentative dans 2 secondes (${this.retryCount}/${this.maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.authenticate();
      }
      
      throw new Error('Échec de l\'authentification Maviance après plusieurs tentatives');
    }
  }

  async ensureToken() {
    // Si pas de token ou expire dans moins d'une minute
    if (!this.accessToken || Date.now() >= (this.tokenExpiry - 60000)) {
      console.log('🔄 Renouvellement du token...');
      await this.authenticate();
    }
    return this.accessToken;
  }

  async makeRequestWithRetry(method, url, data = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.ensureToken();
        
        console.log(`📡 Tentative ${attempt}/${retries}: ${method} ${url}`);
        
        const config = {
          method,
          url,
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 30000
        };
        
        if (data) {
          config.data = data;
        }
        
        const response = await axios(config);
        
        console.log(`✅ Réponse ${method} ${url}:`, {
          status: response.status,
          data: response.data
        });
        
        return response.data;
        
      } catch (error) {
        console.error(`❌ Erreur tentative ${attempt}/${retries}:`, {
          message: error.message,
          url: url,
          status: error.response?.status,
          data: error.response?.data,
          method: method
        });
        
        // Si c'est une erreur d'authentification, ré-authentifier
        if (error.response?.status === 401 || error.response?.status === 403) {
          console.log('🔄 Token expiré, ré-authentification...');
          this.accessToken = null;
          this.tokenExpiry = null;
        }
        
        if (attempt === retries) {
          throw error;
        }
        
        // Attente exponentielle
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`⏳ Attente de ${delay}ms avant nouvelle tentative...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async initiatePayment(paymentData) {
    try {
      console.log('🚀 Initiation paiement Maviance:', paymentData);
      
      const payload = {
        amount: parseFloat(paymentData.amount),
        serviceNumber: paymentData.serviceNumber,
        customerName: paymentData.customerName,
        customerEmailaddress: paymentData.customerEmail,
        customerAddress: paymentData.customerAddress || "Douala, Cameroun",
        paymentMethod: paymentData.paymentMethod.toUpperCase() === 'MTN' ? 'MTN' : 'OM',
        description: `Cultures News Premium - ${paymentData.customerName}`,
        currency: 'XAF',
        merchantReference: `CULTURES-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };

      console.log('📦 Payload Maviance:', JSON.stringify(payload, null, 2));

      const response = await this.makeRequestWithRetry(
        'POST',
        `${this.baseURL}/api/v2/payment`,
        payload
      );

      if (!response.ptn) {
        throw new Error('PTN non reçu dans la réponse Maviance');
      }

      console.log('🎉 Paiement initié avec succès, PTN:', response.ptn);
      return response;

    } catch (error) {
      console.error('❌ Erreur détaillée initiation paiement Maviance:', {
        message: error.message,
        stack: error.stack,
        paymentData: paymentData
      });
      
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error_description ||
                          error.message ||
                          'Échec de l\'initiation du paiement';
      
      throw new Error(`Maviance: ${errorMessage}`);
    }
  }

  async getPaymentStatus(ptn) {
    try {
      if (!ptn) {
        throw new Error('PTN requis');
      }
      
      console.log('🔍 Vérification statut paiement pour PTN:', ptn);
      
      const response = await this.makeRequestWithRetry(
        'GET',
        `${this.baseURL}/api/v2/payment/${ptn}`
      );

      console.log('📊 Statut paiement pour', ptn, ':', response);
      return response;

    } catch (error) {
      console.error('❌ Erreur vérification statut Maviance:', {
        ptn: ptn,
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      
      // Pour les erreurs 404, on considère que le paiement n'existe pas encore
      if (error.response?.status === 404) {
        return {
          responseData: [{
            status: 'PENDING',
            message: 'Transaction non trouvée, peut-être pas encore traitée'
          }]
        };
      }
      
      throw new Error(`Échec de la vérification du statut: ${error.message}`);
    }
  }

  // Fonction utilitaire pour les messages d'erreur
  getErrorMessage(errorCode) {
    const errorMessages = {
      '100': 'Transaction approuvée',
      '101': 'Transaction échouée',
      '102': 'Transaction en attente',
      '103': 'Transaction annulée',
      '104': 'Fonds insuffisants',
      '105': 'Numéro de téléphone invalide',
      '106': 'Service temporairement indisponible',
      '107': 'Montant invalide',
      '108': 'Opérateur non supporté',
      '109': 'Transaction expirée',
      '110': 'Paramètres invalides',
      '111': 'Compte marchand suspendu',
      '112': 'Limite de transaction dépassée',
      '113': 'Doublon de transaction',
      '114': 'Maintenance du système',
      '115': 'Erreur de réseau',
      '116': 'Timeout de la transaction',
      '117': 'Utilisateur a refusé',
      '118': 'Code PIN incorrect',
      '119': 'Compte bloqué',
      '120': 'Service non disponible pour cet opérateur'
    };
    
    return errorMessages[errorCode?.toString()] || 
           `Erreur de paiement (code: ${errorCode || 'inconnu'})`;
  }
}

module.exports = new MavianceClient();