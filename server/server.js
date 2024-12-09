require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(morgan('dev'));

// Environment Variables
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// Connect to MongoDB Atlas
mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB Atlas Connected'))
  .catch((err) => console.error('MongoDB Atlas Connection Error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
});

const travelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  destination: String,
  budget: Number,
  date: Date,
  nights: Number,
});

const User = mongoose.model('User', userSchema);
const Travel = mongoose.model('Travel', travelSchema);

// Middleware for Authentication
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied!' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token!' });
  }
};

// Routes

// Signup Route
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required!' });
  }
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists!' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: 'User registered successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error!' });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'All fields are required!' });
  }
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid email or password!' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid email or password!' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    res.status(200).json({
      message: 'Login successful!',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error!' });
  }
});

// Budget Calculation Route
app.post('/calculate-budget', async (req, res) => {
  const { startingPoint, destination, nights, travelers, budgetLevel, transportMode, transportSubtype, shoppingAmount } = req.body;
  
  const pricing = {
    'Mid-Range': { hotelCostPerNight: 1500, foodCostPerDay: 600 },
    'Luxury': { hotelCostPerNight: 3000, foodCostPerDay: 1200 },
  };

  const transportPricing = {
    Bus: {
      'Ordinary State Bus': 2, // ₹2 per km
      'Volvo Non-AC': 3.5, // ₹3.5 per km
      'AC Bus': 5, // ₹5 per km
    },
    Train: {
      Sleeper: 1.5, // ₹1.5 per km
      'AC 3 Tier': 3, // ₹3 per km
      'AC 2 Tier': 4.5, // ₹4.5 per km
      'AC First Class': 7, // ₹7 per km
    },
    Flight: {
      Economy: 8, // ₹8 per km
      Business: 15, // ₹15 per km
      'First Class': 25, // ₹25 per km
    },
  };

  if (!pricing[budgetLevel] || !transportPricing[transportMode] || !transportPricing[transportMode][transportSubtype]) {
    return res.status(400).json({ error: 'Invalid budget level or transportation type.' });
  }

  const { hotelCostPerNight, foodCostPerDay } = pricing[budgetLevel];
  const perKmRate = transportPricing[transportMode][transportSubtype];

  try {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      { params: { origins: startingPoint, destinations: destination, key: process.env.GOOGLE_MAPS_API_KEY } }
    );
    const distance = response.data.rows[0].elements[0].distance?.value || 0;
    const distanceKm = distance / 1000;

    const transportationCost = travelers * distanceKm * perKmRate;
    const foodCost = travelers * nights * foodCostPerDay;
    const shoppingCost = shoppingAmount ? parseFloat(shoppingAmount) : 0;
    const hotelCost = travelers * nights * hotelCostPerNight;
    const totalCost = transportationCost + foodCost + shoppingCost + hotelCost;

    res.json({ distanceInKm: distanceKm, transportationCost, foodCost, shoppingCost, hotelCost, totalCost });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching distance data.' });
  }
});

app.post('/get-places', async (req, res) => {
  const { destination } = req.body;

  if (!destination) {
    return res.status(400).json({ error: 'Destination is required.' });
  }

  try {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: {
          query: `Tourist attractions in ${destination}`,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      }
    );

    if (response.data.status !== 'OK') {
      console.error('Google Places API Error:', response.data);
      return res.status(500).json({ error: 'Failed to fetch places data. Please check your Google API key and settings.' });
    }

    const places = response.data.results.map((place) => ({
      name: place.name,
      address: place.formatted_address,
      rating: place.rating,
      photo: place.photos ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${place.photos[0].photo_reference}&key=${process.env.GOOGLE_MAPS_API_KEY}` : null,
    }));

    res.status(200).json(places);
  } catch (error) {
    console.error('Error fetching places:', error);
    res.status(500).json({ error: 'Error fetching places data.' });
  }
});

// Save Travel Data Route
app.post('/save-travel', authenticateToken, async (req, res) => {
  const { destination, budget, nights } = req.body;

  if (!destination || !budget || !nights) {
    console.error('Save Travel Error: Missing required fields', { destination, budget, nights });
    return res.status(400).json({ error: 'All fields are required!' });
  }

  try {
    const travel = new Travel({
      userId: req.user.id,
      destination,
      budget,
      date: new Date(),
      nights,
    });
    await travel.save();
    res.status(201).json({ message: 'Travel data saved successfully!' });
  } catch (error) {
    console.error('Error saving travel data:', error);
    res.status(500).json({ error: 'Failed to save travel data!' });
  }
});

// Fetch Travel History Route
app.get('/travel-history', authenticateToken, async (req, res) => {
  try {
    const travels = await Travel.find({ userId: req.user.id }).sort({ date: -1 });
    res.status(200).json(travels);
  } catch (error) {
    console.error('Error fetching travel history:', error);
    res.status(500).json({ error: 'Failed to fetch travel history!' });
  }
});

// Start Server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
