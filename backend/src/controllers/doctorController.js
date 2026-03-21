const {dbHelpers} = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Will need to run npm install bcryptjs

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development_only';

// Hardcoded initial doctor for deployment ease. In production, registration should be managed via admin console.
async function ensureDefaultDoctor() {
  try {
    const existing = await dbHelpers.get('SELECT * FROM doctors WHERE username = $1', ['admin_doctor']);
    if (!existing) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('nurseai2026', salt);
      await dbHelpers.run(
        'INSERT INTO doctors (username, password_hash, doctor_name) VALUES ($1, $2, $3)',
        ['admin_doctor', hash, 'Dr. Chief Medical Officer']
      );
      console.log('Created default doctor account (admin_doctor / nurseai2026)');
    }
  } catch (err) {
    console.error('Failed to ensure default doctor:', err);
  }
}

// Ensure it runs once
ensureDefaultDoctor();

async function loginDoctor(req, res) {
  try {
    const {username, password} = req.body;

    if (!username || !password) {
      return res.status(400).json({success: false, error: 'Username and password required'});
    }

    const doctor = await dbHelpers.get('SELECT * FROM doctors WHERE username = $1', [username]);

    if (!doctor) {
      return res.status(401).json({success: false, error: 'Invalid credentials'});
    }

    const isValid = await bcrypt.compare(password, doctor.password_hash);
    if (!isValid) {
      return res.status(401).json({success: false, error: 'Invalid credentials'});
    }

    const token = jwt.sign({userId: doctor.id, role: 'doctor'}, JWT_SECRET, {expiresIn: '24h'});

    res.json({
      success: true,
      data: {
        token,
        doctor: {
          id: doctor.id,
          username: doctor.username,
          name: doctor.doctor_name,
        },
      },
    });
  } catch (error) {
    console.error('Doctor login error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

async function getVisits(req, res) {
  try {
    // Get all completed gemini suggestions, group by verification status natively
    const query = `
      SELECT t.id, t.title, t.patient_name, t.patient_id, t.created_at, t.verification_status, 
             t.doctor_rating, t.doctor_remarks, t.verified_at, u.email AS nurse_email
      FROM transcripts t
      LEFT JOIN users u ON u.uid = t.user_uid
      WHERE t.source IN ('gemini', 'gemini-diagnosis') 
        AND t.suggestion_completed = true
      ORDER BY t.created_at DESC
    `;
    
    const transcripts = await dbHelpers.all(query, []);

    // Format for frontend grouping
    const result = {
      unverified: transcripts.filter(t => t.verification_status === 'unverified'),
      verified: transcripts.filter(t => t.verification_status === 'verified'),
      flagged: transcripts.filter(t => t.verification_status === 'flagged'),
    };

    res.json({success: true, data: result});
  } catch (error) {
    console.error('Get doctor visits error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

async function verifyVisit(req, res) {
  try {
    const {id} = req.params;
    const {rating, remarks} = req.body;

    if (rating === undefined || rating < 1 || rating > 10) {
      return res.status(400).json({success: false, error: 'Valid rating between 1-10 is required'});
    }

    // Determine status automatically based on score. < 7 is flagged.
    const status = parseInt(rating, 10) < 7 ? 'flagged' : 'verified';

    await dbHelpers.run(
      `UPDATE transcripts 
       SET verification_status = $1, doctor_rating = $2, doctor_remarks = $3, verified_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, parseInt(rating, 10), remarks || null, id]
    );

    res.json({
      success: true, 
      data: {
        status, 
        rating, 
        remarks
      }
    });
  } catch (error) {
    console.error('Verify visit error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

module.exports = {
  loginDoctor,
  getVisits,
  verifyVisit,
};
