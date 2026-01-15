// Dashboard Controller
const {dbHelpers} = require('../config/database');

// Get dashboard summary
async function getDashboardSummary(req, res) {
  try {
    const userId = req.userId;

    // Get pending tasks count
    const pendingResult = await dbHelpers.get(
      'SELECT COUNT(*)::int as count FROM patient_tasks WHERE user_uid = $1 AND status = $2',
      [userId, 'Pending']
    );

    // Get done tasks count
    const doneResult = await dbHelpers.get(
      'SELECT COUNT(*)::int as count FROM patient_tasks WHERE user_uid = $1 AND status = $2',
      [userId, 'Done']
    );

    res.json({
      success: true,
      data: {
        pending: parseInt(pendingResult?.count) || 0,
        done: parseInt(doneResult?.count) || 0,
      },
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Get patient tasks
async function getPatientTasks(req, res) {
  try {
    const userId = req.userId;
    const {sortBy = 'emergency', patientName, patientId} = req.query;

    // Build query with optional filters
    let query = 'SELECT * FROM patient_tasks WHERE user_uid = $1';
    const params = [userId];
    let paramIndex = 2;

    if (patientName) {
      query += ` AND LOWER(patient_name) = LOWER($${paramIndex})`;
      params.push(patientName.trim());
      paramIndex++;
    }

    if (patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(patientId.trim());
      paramIndex++;
    }

    let orderBy = 'created_at DESC';
    if (sortBy === 'emergency') {
      orderBy = `
        CASE 
          WHEN emergency_level = 'HIGH' THEN 1
          WHEN emergency_level = 'MEDIUM' THEN 2
          WHEN emergency_level = 'LOW' THEN 3
          ELSE 4
        END,
        scheduled_time ASC
      `;
    }

    query += ` ORDER BY ${orderBy}`;

    const tasks = await dbHelpers.all(query, params);

    // Format tasks
    const formattedTasks = tasks.map((task) => ({
      id: task.id,
      patientName: task.patient_name,
      patientId: task.patient_id,
      taskDescription: task.task_description,
      scheduledTime: task.scheduled_time,
      emergencyLevel: task.emergency_level,
      status: task.status,
    }));

    res.json({
      success: true,
      data: formattedTasks,
    });
  } catch (error) {
    console.error('Get patient tasks error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

module.exports = {
  getDashboardSummary,
  getPatientTasks,
};
