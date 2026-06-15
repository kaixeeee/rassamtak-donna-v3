function padOrderNumber(n) { return String(n).padStart(3, '0'); }
function makeOrderId(n) { return `#${padOrderNumber(n)}`; }
module.exports = { padOrderNumber, makeOrderId };
