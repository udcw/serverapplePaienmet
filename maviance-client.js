const axios = require('axios');

class MavianceClient {
  constructor() {
    this.baseURL = process.env.MAVIANCE_BASE_URL;
    this.clientId = process.env.MAVIANCE_CLIENT_ID;
    this.clientSecret = process.env.MAVIANCE_CLIENT_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async authenticate() {
    try {
      const response = await axios.post(`${this.baseURL}/oauth/v2/token`, null, {
        params: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      console.log('Authentification Maviance réussie');
      return this.accessToken;
    } catch (error) {
      console.error('Erreur authentification Maviance:', error.response?.data || error.message);
      throw new Error('Échec de l\'authentification Maviance');
    }
  }

  async ensureToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
    return this.accessToken;
  }

  async initiatePayment(paymentData) {
    try {
      await this.ensureToken();

      const payload = {
        amount: paymentData.amount,
        serviceNumber: paymentData.serviceNumber,
        customerName: paymentData.customerName,
        customerEmailaddress: paymentData.customerEmail,
        customerAddress: paymentData.customerAddress || "Douala",
        paymentMethod: paymentData.paymentMethod === 'mtn' ? 'MTN' : 'OM',
        description: `Cultures News Premium - ${paymentData.customerName}`,
        currency: 'XAF'
      };

      console.log('Envoi paiement Maviance:', payload);

      const response = await axios.post(
        `${this.baseURL}/api/v2/payment`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      console.log('Réponse Maviance:', response.data);
      return response.data;

    } catch (error) {
      console.error('Erreur initiation paiement Maviance:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      throw new Error(error.response?.data?.message || 'Échec de l\'initiation du paiement');
    }
  }

  async getPaymentStatus(ptn) {
    try {
      await this.ensureToken();

      const response = await axios.get(
        `${this.baseURL}/api/v2/payment/${ptn}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          },
          timeout: 10000
        }
      );

      return response.data;

    } catch (error) {
      console.error('Erreur vérification statut Maviance:', error.response?.data || error.message);
      throw new Error('Échec de la vérification du statut');
    }
  }

  // Fonction utilitaire pour les messages d'erreur
  getErrorMessage(errorCode) {
    const errorMessages = {
      100: 'Transaction approuvée',
      101: 'Transaction échouée',
      102: 'Transaction en attente',
      103: 'Transaction annulée',
      104: 'Fonds insuffisants',
      105: 'Numéro de téléphone invalide',
      106: 'Service temporairement indisponible',
      107: 'Montant invalide',
      108: 'Opérateur non supporté',
      109: 'Transaction expirée',
      110: 'Paramètres invalides'
    };
    
    return errorMessages[errorCode] || `Erreur inconnue (code: ${errorCode})`;
  }
}

module.exports = new MavianceClient();