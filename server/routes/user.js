const express = require('express');
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');

const router = express.Router();

// Get User Data
router.get('/user-data', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

module.exports = router;
