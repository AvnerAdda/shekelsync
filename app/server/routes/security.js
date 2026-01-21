const { Router } = require('express');
const securityStatusManager = require('../../../electron/security/security-status.js');

const router = Router();

/**
 * GET /api/security/status
 * Get comprehensive security status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await securityStatusManager.getSecurityStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('[Security API] Failed to get security status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve security status',
      message: error.message,
    });
  }
});

/**
 * GET /api/security/summary
 * Get security summary (simplified view)
 */
router.get('/summary', async (req, res) => {
  try {
    const summary = await securityStatusManager.getSecuritySummary();
    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('[Security API] Failed to get security summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve security summary',
      message: error.message,
    });
  }
});

/**
 * POST /api/security/authenticate
 * Trigger biometric authentication (future use)
 */
router.post('/authenticate', async (req, res) => {
  try {
    // This will be implemented when we add the biometric auth manager
    res.json({
      success: false,
      message: 'Biometric authentication not yet implemented',
    });
  } catch (error) {
    console.error('[Security API] Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      message: error.message,
    });
  }
});

module.exports = router;
