const b = require('bcryptjs');
console.log(b.hashSync('Admin@123', 10));
