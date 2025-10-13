import breakdownHandler from './breakdown.js';

export default function handler(req, res) {
  req.query = { ...req.query, type: 'income' };
  return breakdownHandler(req, res);
}
