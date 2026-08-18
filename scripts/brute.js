const snmp = require('net-snmp');
const passwords = ['cnmsuser2', 'Cisco123!', 'cisco', 'password', 'Strong#Pass123!', 'admin', 'public', 'private', 'cnmsuser'];

async function test(pass) {
  return new Promise((resolve) => {
    const user = {
      name: 'cnmsuser2',
      level: snmp.SecurityLevel.authPriv,
      authProtocol: snmp.AuthProtocols.sha,
      authKey: pass,
      privProtocol: snmp.PrivProtocols.des,
      privKey: pass
    };
    const session = snmp.createV3Session('192.168.5.4', user, { port: 161, timeout: 500, retries: 0 });
    session.get(['1.3.6.1.2.1.1.5.0'], (error, varbinds) => {
      session.close();
      if (error) {
        resolve({ pass, success: false, error: error.message });
      } else {
        resolve({ pass, success: true });
      }
    });
  });
}

async function run() {
  for (const pass of passwords) {
    console.log('Testing:', pass);
    const res = await test(pass);
    if (res.success) {
      console.log('SUCCESS with password:', pass);
      process.exit(0);
    } else {
      console.log('Failed:', res.error);
    }
  }
}
run();
