const bcrypt = require('bcryptjs');
const { connection } = require('./config/database');

async function createAdmin() {
    try {
        // Hash du mot de passe "Admin12345"
        const password = "Admin12345";
        const hashedPassword = await bcrypt.hash(password, 10);
        
        console.log('🔐 NOUVEAU HASH généré:');
        console.log(hashedPassword);
        
        // Exécuter les requêtes une par une
        connection.query('USE sigap_db', (err) => {
            if (err) {
                console.error('❌ Erreur USE:', err);
                return;
            }
            
            // Supprimer l'admin existant
            connection.query("DELETE FROM users WHERE username = 'admin'", (err) => {
                if (err) {
                    console.error('❌ Erreur DELETE:', err);
                    return;
                }
                
                // Insérer le nouvel admin
                const insertQuery = `
                    INSERT INTO users (immatricule, nom_complet, username, password, role) 
                    VALUES (?, ?, ?, ?, ?)
                `;
                
                connection.query(insertQuery, [
                    'ADMIN001', 
                    'Administrateur SIGAP', 
                    'admin', 
                    hashedPassword, 
                    'admin'
                ], (err, results) => {
                    if (err) {
                        console.error('❌ Erreur INSERT:', err);
                        return;
                    }
                    
                    console.log('✅ Admin créé avec succès!');
                    console.log('📋 Identifiants:');
                    console.log('   Username: admin');
                    console.log('   Password: Admin12345');
                    console.log('   Hash:', hashedPassword);
                    
                    // Vérifier
                    connection.query("SELECT username, role FROM users WHERE username = 'admin'", (err, results) => {
                        if (err) {
                            console.error('❌ Erreur vérification:', err);
                            return;
                        }
                        console.log('👤 Utilisateur créé:', results[0]);
                        process.exit();
                    });
                });
            });
        });
        
    } catch (error) {
        console.error('❌ Erreur:', error);
    }
}

createAdmin();