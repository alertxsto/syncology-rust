use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirebaseUser {
    #[serde(default, rename = "uid")]
    pub uid: String,
    
    #[serde(default, rename = "displayName")]
    pub display_name: String,
    
    #[serde(default)]
    pub email: String,
    
    #[serde(default, rename = "photoURL", alias = "photoUrl")]
    pub photo_url: String,
    
    #[serde(default, rename = "idToken")]
    pub id_token: String,
    
    #[serde(default, rename = "refreshToken")]
    pub refresh_token: String,
    
    #[serde(default, rename = "localId")]
    pub local_id: String,
}

impl FirebaseUser {
    pub fn is_authenticated(&self) -> bool {
        !self.id_token.is_empty()
    }
}
