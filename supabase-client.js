const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Validation des variables d'environnement
if (!supabaseUrl) {
  throw new Error('❌ SUPABASE_URL est manquant dans les variables d\'environnement');
}

if (!supabaseServiceKey) {
  throw new Error('❌ SUPABASE_SERVICE_KEY est manquant dans les variables d\'environnement');
}

console.log('🔗 Configuration Supabase:');
console.log('   URL:', supabaseUrl ? supabaseUrl.substring(0, 20) + '...' : 'Non défini');
console.log('   Clé:', supabaseServiceKey ? '✓ Configurée' : '✗ Manquante');

// Configuration du client Supabase
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  },
  global: {
    headers: {
      'x-application-name': 'cultures-news-payment-api',
      'x-application-version': '1.0.0'
    }
  },
  db: {
    schema: 'public'
  }
});

// Fonction pour tester la connexion
async function testConnection() {
  try {
    console.log('🧪 Test de connexion à Supabase...');
    
    const { data, error } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('❌ Erreur connexion Supabase:', error.message);
      return false;
    }
    
    console.log('✅ Connexion Supabase réussie');
    return true;
    
  } catch (error) {
    console.error('❌ Exception connexion Supabase:', error.message);
    return false;
  }
}

// Fonction pour vérifier si une table existe
async function checkTableExists(tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (error && error.code === '42P01') {
      console.error(`❌ Table "${tableName}" n'existe pas`);
      return false;
    }
    
    console.log(`✅ Table "${tableName}" existe`);
    return true;
    
  } catch (error) {
    console.error(`❌ Erreur vérification table "${tableName}":`, error.message);
    return false;
  }
}

// Fonction pour obtenir les informations de l'utilisateur
async function getUserProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('❌ Erreur récupération profil:', error.message);
      return null;
    }
    
    return data;
    
  } catch (error) {
    console.error('❌ Exception récupération profil:', error.message);
    return null;
  }
}

// Fonction pour mettre à jour le statut premium
async function updatePremiumStatus(userId, isPremium = true, durationMonths = 12) {
  try {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + durationMonths);
    
    const { data, error } = await supabase
      .from('profiles')
      .update({
        is_premium: isPremium,
        last_payment_date: new Date().toISOString(),
        premium_expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();
    
    if (error) {
      console.error('❌ Erreur mise à jour statut premium:', error.message);
      return null;
    }
    
    console.log(`✅ Statut premium mis à jour pour ${userId}:`, isPremium);
    return data;
    
  } catch (error) {
    console.error('❌ Exception mise à jour statut premium:', error.message);
    return null;
  }
}

// Exporter les fonctions
module.exports = {
  supabase,
  testConnection,
  checkTableExists,
  getUserProfile,
  updatePremiumStatus
};