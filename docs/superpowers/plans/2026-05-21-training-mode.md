# Chaos Fire Drill 训练模式实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增训练模式——任务闯关(A) + 排错挑战(B)，覆盖 OpenStack CLI 和 Linux CLI，每关结束后 AI 评分和建议。

**Architecture:** 在现有 game-server 下新增 `training/` 模块（openstack-mock.js, linux-sandbox.js, training-engine.js, level-loader.js, training-scorer.js），扩展 terminal-proxy.js 白名单和 ai-engine.js，新增 2 个前端组件。训练模式通过独立 API 端点 (`/api/training/*`) 和 WebSocket 消息类型与现有系统隔离，不修改练习/实战模式的任何逻辑。

**Tech Stack:** Node.js, Express, ws, Vue 3, Jest

---

### Task 1: OpenStack Mock 引擎

**Files:**
- Create: `game-server/training/openstack-mock.js`
- Test: `game-server/__tests__/openstack-mock.test.js`

- [ ] **Step 1: Write the test file**

```javascript
const OpenStackMock = require('../training/openstack-mock');

describe('OpenStackMock', () => {
  let os;

  beforeEach(() => { os = new OpenStackMock(); });

  test('initial state has default flavors', () => {
    const flavors = os.exec('openstack flavor list');
    expect(flavors).toContain('m1.tiny');
    expect(flavors).toContain('m1.small');
    expect(flavors).toContain('m1.medium');
  });

  test('image create adds image to state', () => {
    const result = os.exec('openstack image create ubuntu --disk-format qcow2 --file ubuntu.qcow2');
    expect(result).toContain('ubuntu');
    expect(os.state.images.length).toBe(1);
    expect(os.state.images[0].name).toBe('ubuntu');
    expect(os.state.images[0].diskFormat).toBe('qcow2');
  });

  test('image list returns formatted table', () => {
    os.exec('openstack image create cirros --disk-format qcow2');
    const result = os.exec('openstack image list');
    expect(result).toContain('cirros');
    expect(result).toContain('ID');
    expect(result).toContain('Name');
  });

  test('network create adds network', () => {
    os.exec('openstack network create selfservice');
    expect(os.state.networks.length).toBe(1);
    expect(os.state.networks[0].name).toBe('selfservice');
  });

  test('subnet create attaches to network', () => {
    os.exec('openstack network create selfservice');
    os.exec('openstack subnet create subnet1 --network selfservice --subnet-range 172.16.0.0/24');
    expect(os.state.subnets.length).toBe(1);
    expect(os.state.subnets[0].cidr).toBe('172.16.0.0/24');
  });

  test('router create and add subnet', () => {
    os.exec('openstack network create selfservice');
    os.exec('openstack subnet create sub1 --network selfservice --subnet-range 172.16.0.0/24');
    os.exec('openstack router create router1');
    const result = os.exec('openstack router add subnet router1 sub1');
    expect(os.state.routers[0].name).toBe('router1');
    expect(os.state.routers[0].interfaces).toContain('sub1');
  });

  test('server create launches instance', () => {
    os.exec('openstack image create ubuntu --disk-format qcow2');
    os.exec('openstack flavor create m1.tiny --vcpus 1 --ram 512 --disk 1');
    os.exec('openstack network create selfservice');
    os.exec('openstack keypair create mykey');
    const result = os.exec('openstack server create vm1 --image ubuntu --flavor m1.tiny --network selfservice --key-name mykey');
    expect(os.state.instances.length).toBe(1);
    expect(os.state.instances[0].name).toBe('vm1');
    expect(os.state.instances[0].status).toBe('ACTIVE');
  });

  test('server stop and start', () => {
    os.exec('openstack image create ubuntu --disk-format qcow2');
    os.exec('openstack flavor create m1.tiny --vcpus 1 --ram 512 --disk 1');
    os.exec('openstack network create selfservice');
    os.exec('openstack server create vm1 --image ubuntu --flavor m1.tiny --network selfservice');
    os.exec('openstack server stop vm1');
    expect(os.state.instances[0].status).toBe('SHUTOFF');
    os.exec('openstack server start vm1');
    expect(os.state.instances[0].status).toBe('ACTIVE');
  });

  test('security group rule create', () => {
    os.exec('openstack security group rule create default --protocol tcp --dst-port 22:22 --remote-ip 0.0.0.0/0');
    expect(os.state.securityGroups[0].rules.length).toBe(1);
    expect(os.state.securityGroups[0].rules[0].portRange).toBe('22:22');
  });

  test('keypair create', () => {
    os.exec('openstack keypair create mykey');
    expect(os.state.keypairs.length).toBe(1);
    expect(os.state.keypairs[0].name).toBe('mykey');
  });

  test('volume create', () => {
    os.exec('openstack volume create vol1 --size 10');
    expect(os.state.volumes.length).toBe(1);
    expect(os.state.volumes[0].size).toBe(10);
  });

  test('unknown command returns error-like message', () => {
    const result = os.exec('openstack unknown cmd');
    expect(result).toContain('not recognized');
  });

  test('state check helper evaluates conditions', () => {
    os.exec('openstack network create selfservice');
    const result = os.checkState('state.networks.length === 1 && state.networks[0].name === "selfservice"');
    expect(result).toBe(true);
    const fail = os.checkState('state.networks.length === 2');
    expect(fail).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game-server && npx jest __tests__/openstack-mock.test.js --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Write openstack-mock.js**

```javascript
// OpenStack Mock — simulates OpenStack CLI for training mode
class OpenStackMock {
  constructor() {
    this.state = {
      images: [],
      flavors: [
        { id: '1', name: 'm1.tiny', vcpus: 1, ram: 512, disk: 1, ephemeral: 0 },
        { id: '2', name: 'm1.small', vcpus: 1, ram: 2048, disk: 20, ephemeral: 0 },
        { id: '3', name: 'm1.medium', vcpus: 2, ram: 4096, disk: 40, ephemeral: 0 },
      ],
      networks: [],
      subnets: [],
      routers: [],
      securityGroups: [{ name: 'default', rules: [] }],
      keypairs: [],
      instances: [],
      volumes: [],
    };
    this._idCounter = 100;
  }

  _nextId() { return String(++this._idCounter); }

  exec(rawCommand) {
    const parts = this._tokenize(rawCommand);
    if (parts[0] !== 'openstack') return 'not recognized: expected openstack command';

    const cmd = parts[1];
    const subcmd = parts[2];

    try {
      switch (cmd) {
        case 'image': return this._handleImage(subcmd, parts.slice(3));
        case 'network': return this._handleNetwork(subcmd, parts.slice(3));
        case 'subnet': return this._handleSubnet(subcmd, parts.slice(3));
        case 'router': return this._handleRouter(subcmd, parts.slice(3));
        case 'flavor': return this._handleFlavor(subcmd, parts.slice(3));
        case 'server': return this._handleServer(subcmd, parts.slice(3));
        case 'keypair': return this._handleKeypair(subcmd, parts.slice(3));
        case 'security': return this._handleSecurity(subcmd, parts.slice(3));
        case 'volume': return this._handleVolume(subcmd, parts.slice(3));
        default: return `openstack: '${cmd}' is not recognized as an openstack command.`;
      }
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  _tokenize(raw) {
    const tokens = [];
    let current = ''; let inQuote = false; let quoteChar = '';
    for (const ch of raw) {
      if (inQuote) {
        if (ch === quoteChar) { inQuote = false; }
        else { current += ch; }
      } else if (ch === '\'' || ch === '"') {
        inQuote = true; quoteChar = ch;
      } else if (ch === ' ') {
        if (current) tokens.push(current);
        current = '';
      } else { current += ch; }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  _parseFlags(args) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        const key = args[i].replace(/^--/, '');
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next; i++;
        } else {
          flags[key] = true;
        }
      } else {
        positional.push(args[i]);
      }
    }
    return { positional, flags };
  }

  /* ── Image ── */
  _handleImage(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const img = { id: this._nextId(), name, diskFormat: flags['disk-format'] || 'qcow2',
          containerFormat: flags['container-format'] || 'bare', size: flags['min-disk'] || 0,
          status: 'active' };
        this.state.images.push(img);
        return this._fmtTable(['ID', 'Name', 'Disk Format', 'Size', 'Status'],
          [[img.id, img.name, img.diskFormat, String(img.size), img.status]]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'Disk Format', 'Size', 'Status'],
          this.state.images.map(i => [i.id, i.name, i.diskFormat, String(i.size), i.status]));
      case 'show': {
        const img = this.state.images.find(i => i.name === positional[0] || i.id === positional[0]);
        if (!img) return `No image with name or ID '${positional[0]}'`;
        return Object.entries(img).map(([k, v]) => `${k}: ${v}`).join('\n');
      }
      case 'delete': {
        const name = positional[0];
        const idx = this.state.images.findIndex(i => i.name === name || i.id === name);
        if (idx >= 0) { this.state.images.splice(idx, 1); return `Image ${name} deleted`; }
        return `No image with name or ID '${name}'`;
      }
      default: return `openstack image: '${subcmd}' not recognized`;
    }
  }

  /* ── Network ── */
  _handleNetwork(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const net = { id: this._nextId(), name, subnets: [], shared: !!flags['share'],
          external: !!flags['external'], status: 'ACTIVE', adminStateUp: true };
        this.state.networks.push(net);
        return this._fmtTable(['ID', 'Name', 'Subnets'], [[net.id, net.name, '']]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'Subnets'],
          this.state.networks.map(n => [n.id, n.name, n.subnets.join(', ')]));
      default: return `openstack network: '${subcmd}' not recognized`;
    }
  }

  /* ── Subnet ── */
  _handleSubnet(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const netName = flags['network'];
        const net = this.state.networks.find(n => n.name === netName || n.id === netName);
        if (!net) return `Network '${netName}' not found`;
        const sub = { id: this._nextId(), name, networkId: net.id,
          cidr: flags['subnet-range'] || '', status: 'ACTIVE' };
        this.state.subnets.push(sub);
        net.subnets.push(sub.id);
        return this._fmtTable(['ID', 'Name', 'Network', 'CIDR'],
          [[sub.id, sub.name, netName, sub.cidr]]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'Network', 'CIDR'],
          this.state.subnets.map(s => {
            const net = this.state.networks.find(n => n.id === s.networkId);
            return [s.id, s.name, net ? net.name : '', s.cidr];
          }));
      default: return `openstack subnet: '${subcmd}' not recognized`;
    }
  }

  /* ── Router ── */
  _handleRouter(subcmd, args) {
    const { positional } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const router = { id: this._nextId(), name, interfaces: [], externalGateway: null, status: 'ACTIVE' };
        this.state.routers.push(router);
        return this._fmtTable(['ID', 'Name', 'Status'], [[router.id, router.name, router.status]]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'Status'],
          this.state.routers.map(r => [r.id, r.name, r.status]));
      case 'add': {
        if (positional[0] !== 'subnet') return `Usage: openstack router add subnet <router> <subnet>`;
        const router = this.state.routers.find(r => r.name === positional[1] || r.id === positional[1]);
        const sub = this.state.subnets.find(s => s.name === positional[2] || s.id === positional[2]);
        if (!router) return `Router '${positional[1]}' not found`;
        if (!sub) return `Subnet '${positional[2]}' not found`;
        router.interfaces.push(sub.id);
        return `Subnet ${positional[2]} added to router ${router.name}`;
      }
      case 'set': {
        const router = this.state.routers.find(r => r.name === positional[0] || r.id === positional[0]);
        if (!router) return `Router '${positional[0]}' not found`;
        const { flags } = this._parseFlags(args);
        if (flags['external-gateway']) {
          router.externalGateway = flags['external-gateway'];
          return `Gateway set to ${flags['external-gateway']} for router ${router.name}`;
        }
        return 'No action specified';
      }
      default: return `openstack router: '${subcmd}' not recognized`;
    }
  }

  /* ── Flavor ── */
  _handleFlavor(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const flavor = { id: this._nextId(), name,
          vcpus: parseInt(flags['vcpus']) || 1, ram: parseInt(flags['ram']) || 512,
          disk: parseInt(flags['disk']) || 1 };
        this.state.flavors.push(flavor);
        return this._fmtTable(['ID', 'Name', 'vCPUs', 'RAM', 'Disk'],
          [[flavor.id, flavor.name, String(flavor.vcpus), String(flavor.ram), String(flavor.disk)]]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'vCPUs', 'RAM', 'Disk'],
          this.state.flavors.map(f => [f.id, f.name, String(f.vcpus), String(f.ram), String(f.disk)]));
      default: return `openstack flavor: '${subcmd}' not recognized`;
    }
  }

  /* ── Server ── */
  _handleServer(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const imgName = flags['image'];
        const flavorName = flags['flavor'];
        const netName = flags['network'];
        const img = this.state.images.find(i => i.name === imgName || i.id === imgName);
        const flavor = this.state.flavors.find(f => f.name === flavorName || f.id === flavorName);
        if (!img) return `Image '${imgName}' not found`;
        if (!flavor) return `Flavor '${flavorName}' not found`;
        const inst = { id: this._nextId(), name, imageId: img.id, flavorId: flavor.id,
          networks: netName ? [netName] : [], status: 'ACTIVE', powerState: 1 };
        this.state.instances.push(inst);
        return this._fmtTable(['ID', 'Name', 'Status', 'Networks', 'Image', 'Flavor'],
          [[inst.id, inst.name, inst.status, inst.networks.join(','), imgName, flavorName]]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'Status', 'Networks'],
          this.state.instances.map(i => [i.id, i.name, i.status, i.networks.join(',')]));
      case 'stop': case 'start': case 'reboot': {
        const inst = this._findInstance(positional[0]);
        if (!inst) return `Instance '${positional[0]}' not found`;
        const statusMap = { stop: 'SHUTOFF', start: 'ACTIVE', reboot: 'ACTIVE' };
        inst.status = statusMap[subcmd];
        return `${subcmd === 'stop' ? 'Stopped' : subcmd === 'start' ? 'Started' : 'Rebooted'} instance ${inst.name}`;
      }
      case 'delete': {
        const idx = this.state.instances.findIndex(i => i.name === positional[0] || i.id === positional[0]);
        if (idx >= 0) { this.state.instances.splice(idx, 1); return `Instance ${positional[0]} deleted`; }
        return `Instance '${positional[0]}' not found`;
      }
      case 'resize': {
        const inst = this._findInstance(positional[0]);
        const flavor = this.state.flavors.find(f => f.name === positional[1] || f.id === positional[1]);
        if (!inst) return `Instance '${positional[0]}' not found`;
        if (positional[1] && !flavor) return `Flavor '${positional[1]}' not found`;
        if (flavor) inst.flavorId = flavor.id;
        return `Resized instance ${inst.name}`;
      }
      default: return `openstack server: '${subcmd}' not recognized`;
    }
  }

  _findInstance(ident) {
    return this.state.instances.find(i => i.name === ident || i.id === ident);
  }

  /* ── Keypair ── */
  _handleKeypair(subcmd, args) {
    const { positional } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        this.state.keypairs.push({ name, fingerprint: `fp:${this._nextId()}` });
        return `Keypair '${name}' created`;
      }
      case 'list':
        return this._fmtTable(['Name', 'Fingerprint'],
          this.state.keypairs.map(k => [k.name, k.fingerprint]));
      default: return `openstack keypair: '${subcmd}' not recognized`;
    }
  }

  /* ── Security Group ── */
  _handleSecurity(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    if (subcmd !== 'group') return `openstack security: '${subcmd}' not recognized`;
    const groupSubcmd = positional[0];
    switch (groupSubcmd) {
      case 'rule': {
        const groupSubSubcmd = positional[1];
        if (groupSubSubcmd !== 'create') return `openstack security group rule: '${groupSubSubcmd}' not recognized`;
        const groupName = positional[2];
        const sg = this.state.securityGroups.find(g => g.name === groupName);
        if (!sg) return `Security group '${groupName}' not found`;
        sg.rules.push({
          protocol: flags['protocol'] || 'tcp',
          portRange: flags['dst-port'] || '1:65535',
          remoteIp: flags['remote-ip'] || '0.0.0.0/0',
        });
        return `Rule added to security group '${groupName}'`;
      }
      case 'list':
        return this._fmtTable(['Name', 'Rules'],
          this.state.securityGroups.map(g => [g.name, String(g.rules.length)]));
      default: return `openstack security group: '${groupSubcmd}' not recognized`;
    }
  }

  /* ── Volume ── */
  _handleVolume(subcmd, args) {
    const { positional, flags } = this._parseFlags(args);
    switch (subcmd) {
      case 'create': {
        const name = positional[0];
        const size = parseInt(flags['size']) || 1;
        const vol = { id: this._nextId(), name, size, status: 'available', attachments: [] };
        this.state.volumes.push(vol);
        return this._fmtTable(['ID', 'Name', 'Size', 'Status'],
          [[vol.id, vol.name, String(vol.size), vol.status]]);
      }
      case 'list':
        return this._fmtTable(['ID', 'Name', 'Size', 'Status'],
          this.state.volumes.map(v => [v.id, v.name, String(v.size), v.status]));
      case 'attach': {
        const vol = this.state.volumes.find(v => v.name === positional[0] || v.id === positional[0]);
        if (!vol) return `Volume '${positional[0]}' not found`;
        vol.status = 'in-use'; vol.attachments.push(positional[1] || 'unknown');
        return `Volume ${vol.name} attached`;
      }
      case 'detach': {
        const vol = this.state.volumes.find(v => v.name === positional[0] || v.id === positional[0]);
        if (!vol) return `Volume '${positional[0]}' not found`;
        vol.status = 'available'; vol.attachments = [];
        return `Volume ${vol.name} detached`;
      }
      case 'delete': {
        const idx = this.state.volumes.findIndex(v => v.name === positional[0] || v.id === positional[0]);
        if (idx >= 0) { this.state.volumes.splice(idx, 1); return `Volume ${positional[0]} deleted`; }
        return `Volume '${positional[0]}' not found`;
      }
      default: return `openstack volume: '${subcmd}' not recognized`;
    }
  }

  /* ── Helpers ── */
  _fmtTable(headers, rows) {
    if (rows.length === 0) return headers.join('  ');
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => String(r[i] || '').length)));
    const fmtRow = row => row.map((cell, i) => String(cell || '').padEnd(colWidths[i])).join('  ');
    return [fmtRow(headers), ...rows.map(fmtRow)].join('\n');
  }

  checkState(expression) {
    try {
      const state = this.state;
      return eval(expression);
    } catch (e) {
      return false;
    }
  }

  reset() { this.constructor(); }
}

module.exports = OpenStackMock;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd game-server && npx jest __tests__/openstack-mock.test.js --forceExit`
Expected: 13 passed

---

### Task 2: Linux 沙箱引擎

**Files:**
- Create: `game-server/training/linux-sandbox.js`
- Test: `game-server/__tests__/linux-sandbox.test.js`

- [ ] **Step 1: Write the test file**

```javascript
const LinuxSandbox = require('../training/linux-sandbox');

describe('LinuxSandbox', () => {
  let sandbox;

  beforeEach(() => { sandbox = new LinuxSandbox(); });

  test('execute ls returns listing', () => {
    const result = sandbox.exec('ls');
    expect(result.success).toBe(true);
    expect(result.output).toContain('trainee');
  });

  test('execute echo returns the text', () => {
    const result = sandbox.exec('echo hello world');
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe('hello world');
  });

  test('execute dangerous command is blocked', () => {
    const result = sandbox.exec('rm -rf /');
    expect(result.success).toBe(false);
    expect(result.output).toContain('blocked');
  });

  test('execute rm -fr / is blocked', () => {
    const result = sandbox.exec('rm -fr /');
    expect(result.success).toBe(false);
  });

  test('create and find files', () => {
    sandbox.exec('mkdir -p /home/trainee/testdir');
    sandbox.exec('touch /home/trainee/testdir/file.txt');
    const result = sandbox.exec('find /home/trainee/testdir -name "*.txt"');
    expect(result.output).toContain('file.txt');
  });

  test('disk free check works', () => {
    const free = sandbox.getDiskFreeMB();
    expect(typeof free).toBe('number');
    expect(free).toBeGreaterThan(0);
  });

  test('reset cleans up trainee dir', () => {
    sandbox.exec('touch /home/trainee/reset_test');
    sandbox.reset();
    const result = sandbox.exec('ls /home/trainee/reset_test 2>&1');
    expect(result.output).toContain('No such file');
  });

  test('command timeout kills long-running commands', () => {
    const result = sandbox.exec('sleep 20', 1000);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game-server && npx jest __tests__/linux-sandbox.test.js --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Write linux-sandbox.js**

```javascript
// Linux Sandbox — executes real Linux commands in a safe sandbox
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TRAINEE_HOME = '/home/trainee';
const DEFAULT_TIMEOUT = 10000;

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-fr\s+\//,
  /rm\s+-rf\s+\/etc/,
  /rm\s+-rf\s+\/boot/,
  /rm\s+-rf\s+\/sys/,
  />\s*\/dev\/sda/,
  />\s*\/dev\/nvme/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  />\s*\/etc\/passwd/,
  />\s*\/etc\/shadow/,
];

const ALLOWED_COMMANDS = [
  'ls', 'cat', 'grep', 'find', 'chmod', 'chown', 'chgrp',
  'ps', 'kill', 'killall', 'pgrep', 'pkill',
  'df', 'du', 'free', 'top', 'htop',
  'netstat', 'ss', 'curl', 'wget', 'ping', 'traceroute',
  'ip', 'ifconfig', 'hostname', 'whoami', 'id',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'echo', 'printf', 'mkdir', 'touch', 'cp', 'mv', 'rm',
  'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'awk', 'sed', 'tr',
  'systemctl', 'journalctl', 'dmesg',
  'which', 'whereis', 'file', 'stat',
  'dd',
];

class LinuxSandbox {
  constructor() {
    this._ensureHome();
  }

  _ensureHome() {
    if (!fs.existsSync(TRAINEE_HOME)) {
      fs.mkdirSync(TRAINEE_HOME, { recursive: true });
    }
  }

  exec(rawCommand, timeout = DEFAULT_TIMEOUT) {
    const trimmed = rawCommand.trim();
    if (!trimmed) return { success: false, output: 'Empty command', command: rawCommand };

    // Danger check
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { success: false, output: `Command blocked by security policy: ${pattern}`, command: rawCommand };
      }
    }

    // Whitelist check
    const baseCmd = trimmed.split(/\s+/)[0];
    const isAllowed = ALLOWED_COMMANDS.some(c =>
      baseCmd === c || baseCmd.startsWith(c + '/') || baseCmd.endsWith('/' + c));
    if (!isAllowed) {
      return { success: false, output: `Command '${baseCmd}' not in training allowlist`, command: rawCommand };
    }

    try {
      const output = execSync(trimmed, {
        encoding: 'utf8',
        timeout,
        cwd: TRAINEE_HOME,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, HOME: TRAINEE_HOME },
      });
      return { success: true, output: output || '(no output)', command: trimmed };
    } catch (err) {
      return { success: false, output: err.stderr || err.message || 'Command failed', command: trimmed };
    }
  }

  getDiskFreeMB() {
    try {
      const output = execSync(`df -m ${TRAINEE_HOME}`, { encoding: 'utf8', timeout: 5000 });
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].trim().split(/\s+/);
        return parseInt(parts[3]) || 0;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  reset() {
    try {
      fs.rmSync(TRAINEE_HOME, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
    this._ensureHome();
  }
}

module.exports = LinuxSandbox;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd game-server && npx jest __tests__/linux-sandbox.test.js --forceExit`
Expected: 8 passed

---

### Task 3: 关卡定义文件（前 5 关） + 加载器

**Files:**
- Create: `game-server/training/level-loader.js`
- Create: `game-server/training/levels/openstack-task-01.json`
- Create: `game-server/training/levels/openstack-task-02.json`
- Create: `game-server/training/levels/openstack-task-03.json`
- Create: `game-server/training/levels/linux-task-01.json`
- Create: `game-server/training/levels/linux-task-02.json`
- Create: `game-server/training/levels/index.json`
- Test: `game-server/__tests__/level-loader.test.js`

- [ ] **Step 1: Write the test file**

```javascript
const { loadLevels, loadLevel } = require('../training/level-loader');

describe('Level Loader', () => {
  test('loadLevels returns all levels', () => {
    const levels = loadLevels();
    expect(levels.length).toBeGreaterThanOrEqual(5);
    expect(levels[0]).toHaveProperty('id');
    expect(levels[0]).toHaveProperty('category');
    expect(levels[0]).toHaveProperty('mode');
    expect(levels[0]).toHaveProperty('title');
    expect(levels[0]).toHaveProperty('goal');
    expect(levels[0]).toHaveProperty('timeLimit');
  });

  test('loadLevel returns specific level by id', () => {
    const level = loadLevel('openstack-task-01');
    expect(level).not.toBeNull();
    expect(level.id).toBe('openstack-task-01');
    expect(level.mode).toBe('task');
    expect(level.category).toBe('openstack');
  });

  test('loadLevel returns null for unknown id', () => {
    const level = loadLevel('nonexistent');
    expect(level).toBeNull();
  });

  test('index.json matches actual level files', () => {
    const levels = loadLevels();
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'training', 'levels');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json');
    expect(levels.length).toBe(files.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game-server && npx jest __tests__/level-loader.test.js --forceExit`
Expected: FAIL — files not found

- [ ] **Step 3: Write level-loader.js**

```javascript
const fs = require('fs');
const path = require('path');

const LEVELS_DIR = path.join(__dirname, 'levels');

function loadLevels() {
  const files = fs.readdirSync(LEVELS_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
  return files.map(f => JSON.parse(fs.readFileSync(path.join(LEVELS_DIR, f), 'utf8')));
}

function loadLevel(levelId) {
  const filePath = path.join(LEVELS_DIR, `${levelId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { loadLevels, loadLevel };
```

- [ ] **Step 4: Write openstack-task-01.json**

```json
{
  "id": "openstack-task-01",
  "category": "openstack",
  "mode": "task",
  "order": 1,
  "title": "上传云镜像",
  "description": "使用 openstack image create 命令上传一个名为 ubuntu 的云镜像，磁盘格式为 qcow2。\n\n这是 OpenStack 中最基础的操作之一，镜像是一切云实例的起点。",
  "goal": { "type": "state-check", "check": "state.images.length >= 1 && state.images.some(function(i) { return i.name === 'ubuntu'; })" },
  "expectedCommands": ["openstack image create ubuntu --disk-format qcow2"],
  "timeLimit": 120,
  "hints": ["试试 openstack image create --help 查看可用参数", "磁盘格式参数是 --disk-format qcow2"],
  "aiContext": {
    "expectedCommand": "openstack image create ubuntu --disk-format qcow2",
    "relatedCommands": ["openstack image list", "openstack image show", "openstack image delete"],
    "tips": ["用 openstack image list 确认上传成功", "qcow2 是 QEMU 的写时复制格式，最常用的云镜像格式"]
  }
}
```

- [ ] **Step 5: Write openstack-task-02.json**

```json
{
  "id": "openstack-task-02",
  "category": "openstack",
  "mode": "task",
  "order": 2,
  "title": "创建租户网络",
  "description": "使用 openstack 命令创建一个名为 selfservice 的虚拟网络，然后创建一个子网 self-subnet，CIDR 为 172.16.0.0/24，关联到 selfservice 网络。\n\n提示：需要先创建网络，再创建子网。",
  "goal": { "type": "state-check", "check": "state.networks.some(function(n) { return n.name === 'selfservice'; }) && state.subnets.some(function(s) { return s.name === 'self-subnet' && s.cidr === '172.16.0.0/24'; })" },
  "expectedCommands": ["openstack network create selfservice", "openstack subnet create self-subnet --network selfservice --subnet-range 172.16.0.0/24"],
  "timeLimit": 180,
  "hints": ["先 openstack network create selfservice", "然后 openstack subnet create --help 查看子网创建参数"],
  "aiContext": {
    "expectedCommand": "openstack network create selfservice && openstack subnet create self-subnet --network selfservice --subnet-range 172.16.0.0/24",
    "relatedCommands": ["openstack network list", "openstack subnet list", "openstack router create"],
    "tips": ["创建子网需要指定 --subnet-range 参数", "--network 参数关联父网络"]
  }
}
```

- [ ] **Step 6: Write openstack-task-03.json**

```json
{
  "id": "openstack-task-03",
  "category": "openstack",
  "mode": "task",
  "order": 3,
  "title": "启动云实例",
  "description": "在已有镜像 ubuntu、网络 selfservice 的基础上，使用 m1.tiny flavor 创建一个名为 vm1 的云实例。\n\n你需要：\n1. 确认 openstack image list 看到 ubuntu 镜像\n2. 确认 openstack network list 看到 selfservice 网络\n3. 创建 keypair mykey\n4. 用 server create 启动实例",
  "goal": { "type": "state-check", "check": "state.instances.length >= 1 && state.instances.some(function(i) { return i.name === 'vm1' && i.status === 'ACTIVE'; })" },
  "expectedCommands": ["openstack keypair create mykey", "openstack server create vm1 --image ubuntu --flavor m1.tiny --network selfservice --key-name mykey"],
  "timeLimit": 240,
  "hints": ["先创建密钥对: openstack keypair create mykey", "server create 需要 --image, --flavor, --network 参数"],
  "aiContext": {
    "expectedCommand": "openstack server create vm1 --image ubuntu --flavor m1.tiny --network selfservice --key-name mykey",
    "relatedCommands": ["openstack server list", "openstack console url show vm1", "openstack server stop vm1"],
    "tips": ["--key-name 不是必须的但在生产环境中很重要", "可以用 openstack flavor list 查看可用 flavor"]
  }
}
```

- [ ] **Step 7: Write linux-task-01.json**

```json
{
  "id": "linux-task-01",
  "category": "linux",
  "mode": "task",
  "order": 4,
  "title": "文件查找与内容过滤",
  "description": "在 /home/trainee 目录下有一些日志文件。请使用 find 和 grep 命令找到所有 .log 文件中包含 'ERROR' 的行。\n\n提示：先用 find 找到 .log 文件，再用 grep 搜索内容。",
  "goal": { "type": "state-check", "check": "true" },
  "expectedCommands": ["find /home/trainee -name '*.log' -exec grep ERROR {} \\;", "grep -r ERROR /home/trainee --include='*.log'"],
  "timeLimit": 180,
  "setup": {
    "type": "linux-sandbox",
    "actions": [
      { "command": "mkdir -p /home/trainee/logs" },
      { "command": "echo 'INFO: server started' > /home/trainee/logs/app.log" },
      { "command": "echo 'ERROR: connection failed' >> /home/trainee/logs/app.log" },
      { "command": "echo 'INFO: request processed' >> /home/trainee/logs/app.log" },
      { "command": "echo 'ERROR: timeout' > /home/trainee/logs/db.log" },
      { "command": "echo 'INFO: cache cleared' >> /home/trainee/logs/db.log" }
    ]
  },
  "hints": ["试试 find /home/trainee -name '*.log'", "grep 可以递归搜索: grep -r ERROR /home/trainee"],
  "aiContext": {
    "expectedCommand": "grep -r ERROR /home/trainee --include='*.log'",
    "relatedCommands": ["find -name", "grep -rn", "grep -v", "head", "tail", "wc -l"],
    "tips": ["grep -r 可以递归搜索目录", "--include 参数可以过滤文件类型"]
  }
}
```

- [ ] **Step 8: Write linux-task-02.json**

```json
{
  "id": "linux-task-02",
  "category": "linux",
  "mode": "task",
  "order": 5,
  "title": "文件归档与压缩",
  "description": "将 /home/trainee/logs 目录下的所有日志文件打包并压缩为 logs.tar.gz 文件，放到 /home/trainee 目录下。\n\n提示：使用 tar 命令完成。",
  "goal": { "type": "state-check", "check": "true" },
  "expectedCommands": ["tar -czf /home/trainee/logs.tar.gz -C /home/trainee logs", "tar -czf logs.tar.gz logs"],
  "timeLimit": 120,
  "setup": {
    "type": "linux-sandbox",
    "actions": [
      { "command": "mkdir -p /home/trainee/logs" },
      { "command": "echo 'log1' > /home/trainee/logs/a.log" },
      { "command": "echo 'log2' > /home/trainee/logs/b.log" }
    ]
  },
  "hints": ["tar -czf 创建 gzip 压缩的 tar 包", "-C 参数可以指定工作目录"],
  "aiContext": {
    "expectedCommand": "tar -czf /home/trainee/logs.tar.gz -C /home/trainee logs",
    "relatedCommands": ["gzip", "gunzip", "tar -xzf", "tar -tvf", "zip", "unzip"],
    "tips": ["-c 创建, -z gzip压缩, -f 指定文件名", "用 tar -tvf 可以查看压缩包内容而不解压"]
  }
}
```

- [ ] **Step 9: Write index.json**

```json
[
  { "id": "openstack-task-01", "category": "openstack", "mode": "task", "order": 1, "title": "上传云镜像", "unlockAfter": null },
  { "id": "openstack-task-02", "category": "openstack", "mode": "task", "order": 2, "title": "创建租户网络", "unlockAfter": "openstack-task-01" },
  { "id": "openstack-task-03", "category": "openstack", "mode": "task", "order": 3, "title": "启动云实例", "unlockAfter": "openstack-task-02" },
  { "id": "linux-task-01", "category": "linux", "mode": "task", "order": 4, "title": "文件查找与过滤", "unlockAfter": null },
  { "id": "linux-task-02", "category": "linux", "mode": "task", "order": 5, "title": "文件归档与压缩", "unlockAfter": null }
]
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd game-server && npx jest __tests__/level-loader.test.js --forceExit`
Expected: 4 passed

---

### Task 4: 扩展 terminal-proxy.js 白名单

**Files:**
- Modify: `game-server/terminal-proxy.js:5-13` (COMMAND_WHITELIST 新增)
- Modify: `game-server/terminal-proxy.js:15-34` (FORBIDDEN_PATTERNS 新增)

- [ ] **Step 1: Add training command whitelist and extra forbidden patterns**

Add after the existing `COMMAND_WHITELIST` array (line 13), before the FORBIDDEN_PATTERNS:

```javascript
const TRAINING_COMMAND_WHITELIST = [
  'openstack ',
  'ls', 'cat', 'grep', 'find', 'chmod', 'chown',
  'ps', 'kill', 'df', 'du', 'netstat', 'ss', 'curl',
  'tar', 'gzip', 'echo', 'mkdir', 'touch', 'cp', 'mv', 'rm',
  'ping', 'traceroute', 'ip', 'ifconfig', 'systemctl',
  'journalctl', 'dmesg', 'head', 'tail', 'wc', 'sort', 'uniq',
  'dd',
];
```

Add after existing FORBIDDEN_PATTERNS array:

```javascript
  /rm\s+-rf\s+\//,
  /rm\s+-fr\s+\//,
  />\s*\/dev\/sda/,
  />\s*\/dev\/nvme/,
```

Modify the `validate` method to check both whitelists:

```javascript
  validate(command) {
    if (!command || typeof command !== 'string') {
      return { valid: false, error: '命令不能为空' };
    }

    const trimmed = command.trim();

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { valid: false, error: `命令包含禁止的模式: ${pattern}` };
      }
    }

    const allowedByKubectl = COMMAND_WHITELIST.some(prefix => trimmed.startsWith(prefix));
    const allowedByTraining = TRAINING_COMMAND_WHITELIST.some(prefix => trimmed.startsWith(prefix));
    if (!allowedByKubectl && !allowedByTraining) {
      return {
        valid: false,
        error: `命令不在白名单中。`,
      };
    }

    return { valid: true };
  }
```

Add a `setTrainingMode(enabled)` method:

```javascript
  setTrainingMode(enabled) {
    this.trainingMode = enabled;
  }
```

Add to constructor:
```javascript
    this.trainingMode = false;
```

Modify `execute` to skip namespace injection when in training mode:

```javascript
    if (!this.trainingMode) {
      // existing namespace logic
    }
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `cd game-server && npx jest --forceExit`
Expected: All 108 tests still pass

---

### Task 5: 训练评分器

**Files:**
- Create: `game-server/training/training-scorer.js`
- Test: `game-server/__tests__/training-scorer.test.js`

- [ ] **Step 1: Write the test file**

```javascript
const TrainingScorer = require('../training/training-scorer');

describe('TrainingScorer', () => {
  const scorer = new TrainingScorer();

  const makeSession = (overrides = {}) => ({
    level: { title: 'Test', timeLimit: 120 },
    elapsed: overrides.elapsed || 30,
    commandHistory: overrides.commandHistory || [],
    lastCommand: overrides.lastCommand || 'openstack image create ubuntu',
    errors: overrides.errors || 0,
    ...overrides,
  });

  test('perfect score is 100', () => {
    const session = makeSession({ elapsed: 20 });
    const result = scorer.score(session);
    expect(result.total).toBe(100);
  });

  test('slow completion loses speed points', () => {
    const session = makeSession({ elapsed: 100 });
    const result = scorer.score(session);
    expect(result.speed).toBeLessThanOrEqual(30);
  });

  test('command with --help loses standard points', () => {
    const session = makeSession({ lastCommand: 'openstack image create --help' });
    const result = scorer.score(session);
    expect(result.standard).toBeLessThanOrEqual(17);
  });

  test('multiple long flags gain standard points', () => {
    const session = makeSession({ lastCommand: 'openstack image create ubuntu --disk-format qcow2 --min-disk 10' });
    const result = scorer.score(session);
    expect(result.standard).toBe(20);
  });

  test('multiple error attempts lose accuracy', () => {
    const session = makeSession({
      commandHistory: ['wrong', 'wrong again', 'openstack image create ubuntu'],
      errors: 2,
    });
    const result = scorer.score(session);
    expect(result.accuracy).toBeLessThanOrEqual(20);
  });

  test('one-shot perfect gets full accuracy', () => {
    const session = makeSession({ commandHistory: ['openstack image create ubuntu'] });
    const result = scorer.score(session);
    expect(result.accuracy).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game-server && npx jest __tests__/training-scorer.test.js --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Write training-scorer.js**

```javascript
// Training Scorer — calculates scores for training levels
class TrainingScorer {
  score(session) {
    const speedScore = this._scoreSpeed(session.elapsed, session.level.timeLimit);
    const accuracyScore = this._scoreAccuracy(session);
    const standardScore = this._scoreStandard(session);
    return {
      speed: speedScore,
      accuracy: accuracyScore,
      standard: standardScore,
      total: speedScore + accuracyScore + standardScore,
    };
  }

  _scoreSpeed(elapsed, timeLimit) {
    const ratio = elapsed / timeLimit;
    if (ratio <= 0.3) return 50;
    if (ratio <= 0.6) return 40;
    if (ratio <= 1.0) return 30;
    return 10;
  }

  _scoreAccuracy(session) {
    const commandCount = session.commandHistory.length;
    const errorCount = session.commandHistory.filter(c => c.isError).length;
    if (errorCount === 0 && commandCount <= 2) return 30;
    if (errorCount === 0) return 25;
    if (errorCount <= 2) return 20;
    return 10;
  }

  _scoreStandard(session) {
    let score = 10;
    const lastCmd = session.lastCommand || '';
    if (lastCmd.includes('--help')) score -= 3;
    const longFlags = lastCmd.match(/--[a-z-]+/g);
    if (longFlags && longFlags.length >= 2) score += 5;
    return Math.max(0, Math.min(20, score));
  }
}

module.exports = TrainingScorer;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd game-server && npx jest __tests__/training-scorer.test.js --forceExit`
Expected: 6 passed

---

### Task 6: 训练引擎（training-engine.js）

**Files:**
- Create: `game-server/training/training-engine.js`
- Test: `game-server/__tests__/training-engine.test.js`

- [ ] **Step 1: Write the test file**

```javascript
const TrainingEngine = require('../training/training-engine');
const OpenStackMock = require('../training/openstack-mock');
const LinuxSandbox = require('../training/linux-sandbox');
const { loadLevel } = require('../training/level-loader');

describe('TrainingEngine', () => {
  let engine, osMock, linuxSb;

  beforeEach(() => {
    osMock = new OpenStackMock();
    linuxSb = new LinuxSandbox();
    engine = new TrainingEngine(osMock, linuxSb);
  });

  test('loadLevel loads and initializes state', () => {
    const level = loadLevel('openstack-task-01');
    engine.loadLevel(level);
    expect(engine.active).toBe(true);
    expect(engine.session.level.id).toBe('openstack-task-01');
    expect(engine.session.startTime).toBeDefined();
  });

  test('onCommand detects task completion via state check', () => {
    const level = loadLevel('openstack-task-01');
    engine.loadLevel(level);
    // Simulate executing the expected command
    osMock.exec('openstack image create ubuntu --disk-format qcow2');
    const result = engine.checkCompletion();
    expect(result.completed).toBe(true);
  });

  test('onCommand retracks wrong command for task mode', () => {
    const level = loadLevel('openstack-task-01');
    engine.loadLevel(level);
    engine.recordCommand('openstack wrong command', false);
    expect(engine.session.commandHistory.length).toBe(1);
    expect(engine.session.commandHistory[0].isError).toBe(true);
  });

  test('completeLevel calculates score', async () => {
    const level = loadLevel('openstack-task-01');
    engine.loadLevel(level);
    osMock.exec('openstack image create ubuntu --disk-format qcow2');
    engine.recordCommand('openstack image create ubuntu --disk-format qcow2', true);
    const result = await engine.completeLevel();
    expect(result.score).toBeDefined();
    expect(result.score.total).toBeGreaterThan(50);
    expect(result.session.elapsed).toBeGreaterThan(0);
  });

  test('loadLevel with setup runs setup actions', () => {
    const level = loadLevel('linux-task-01');
    engine.loadLevel(level);
    // After setup, log files should exist
    const files = linuxSb.exec('ls /home/trainee/logs/');
    expect(files.output).toContain('app.log');
    expect(files.output).toContain('db.log');
  });

  test('stop abandons current level', () => {
    const level = loadLevel('openstack-task-01');
    engine.loadLevel(level);
    expect(engine.active).toBe(true);
    engine.stop();
    expect(engine.active).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd game-server && npx jest __tests__/training-engine.test.js --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Write training-engine.js**

```javascript
// Training Engine — level state machine for training mode
const TrainingScorer = require('./training-scorer');

class TrainingEngine {
  constructor(openstackMock, linuxSandbox) {
    this.os = openstackMock;
    this.linux = linuxSandbox;
    this.scorer = new TrainingScorer();
    this.active = false;
    this.session = null;
    this.level = null;
  }

  loadLevel(level) {
    this.level = level;
    this.active = true;
    this.session = {
      level,
      commandHistory: [],
      startTime: Date.now(),
      elapsed: 0,
    };

    // Task mode: set initial state
    if (level.category === 'openstack') {
      this.os.reset();
      if (level.initialState) {
        for (const [key, val] of Object.entries(level.initialState)) {
          this.os.state[key] = val;
        }
      }
      // Pre-create dependencies specified in the level
      if (level.preload) {
        for (const cmd of level.preload) {
          this.os.exec(cmd);
        }
      }
    }

    // Run setup actions
    if (level.setup && level.setup.type === 'linux-sandbox') {
      this.linux.reset();
      for (const action of level.setup.actions) {
        this.linux.exec(action.command);
      }
    }
  }

  recordCommand(command, success) {
    if (!this.active) return;
    this.session.commandHistory.push({
      command,
      isError: !success,
      timestamp: Date.now(),
    });
    this.session.elapsed = (Date.now() - this.session.startTime) / 1000;
  }

  checkCompletion() {
    if (!this.active || !this.level) return { completed: false };

    if (this.level.mode === 'task') {
      if (this.level.category === 'openstack') {
        const passed = this.os.checkState(this.level.goal.check);
        if (passed) return { completed: true };
      }
      if (this.level.category === 'linux') {
        // For linux tasks, we check if the last successful command matches expected
        // The frontend triggers completion via a specific check
        if (this.session.commandHistory.some(h => !h.isError && this._matchExpected(h.command))) {
          return { completed: true };
        }
      }
    }

    if (this.level.mode === 'debug') {
      if (this.level.category === 'openstack') {
        const passed = this.os.checkState(this.level.goal.check);
        if (passed) return { completed: true };
      }
      if (this.level.category === 'linux') {
        try {
          const passed = eval(this.level.goal.check.replace('diskFree',
            this.linux.getDiskFreeMB()));
          if (passed) return { completed: true };
        } catch (e) { /* ignore */ }
      }
    }

    return { completed: false };
  }

  _matchExpected(command) {
    if (!this.level.expectedCommands) return false;
    return this.level.expectedCommands.some(expected => {
      const normalizedCmd = command.replace(/\s+/g, ' ').trim();
      const normalizedExp = expected.replace(/\s+/g, ' ').trim();
      return normalizedCmd.includes(normalizedExp) || normalizedExp.includes(normalizedCmd);
    });
  }

  async completeLevel() {
    this.session.elapsed = (Date.now() - this.session.startTime) / 1000;
    this.session.lastCommand = this.session.commandHistory
      .filter(h => !h.isError).map(h => h.command).pop() || '';
    this.session.errors = this.session.commandHistory.filter(h => h.isError).length;
    const score = this.scorer.score(this.session);
    this.active = false;
    return { score, session: this.session };
  }

  stop() {
    this.active = false;
  }

  getState() {
    return {
      active: this.active,
      level: this.level ? { id: this.level.id, category: this.level.category,
        mode: this.level.mode, title: this.level.title, description: this.level.description,
        hints: this.level.hints, timeLimit: this.level.timeLimit } : null,
      elapsed: this.session ? (Date.now() - this.session.startTime) / 1000 : 0,
      commandCount: this.session ? this.session.commandHistory.length : 0,
    };
  }
}

module.exports = TrainingEngine;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd game-server && npx jest __tests__/training-engine.test.js --forceExit`
Expected: 6 passed

---

### Task 7: AI 点评扩展（ai-engine.reviewTraining）

**Files:**
- Modify: `game-server/ai-engine.js` (新增 reviewTraining 方法)

- [ ] **Step 1: Add reviewTraining method to AiEngine**

Add after `attemptRepair` method:

```javascript
  async reviewTraining(session) {
    const prompt = `你是云计算课程的助教。请点评学生的 CLI 操作。

关卡: ${session.level.title}
类型: ${session.level.mode === 'task' ? '任务闯关' : '排错挑战'}
期望命令: ${session.level.aiContext?.expectedCommand || '无'}
用时: ${session.elapsed?.toFixed(1) || 0}s
命令历史:
${(session.commandHistory || []).map(h => (h.isError ? '[错误] ' : '[成功] ') + h.command).join('\n')}

请以 JSON 格式回复（不要包含 markdown 代码块标记）:
{
  "praise": "一句话肯定（中文，20字内）",
  "improvement": "可改进建议（中文，30字内）",
  "alternative": "替代方案（中文，30字内，可选）",
  "learningTip": "建议学习命令（中文，20字内）"
}`;

    if (!this.apiKey) return this._ruleBasedReview(session);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: '你是云计算助教。只回复 JSON，不要 markdown 代码块。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error('AI review failed, using rule-based:', err.message);
    }
    return this._ruleBasedReview(session);
  }

  _ruleBasedReview(session) {
    const errorCount = (session.commandHistory || []).filter(h => h.isError).length;
    return {
      praise: errorCount === 0 ? '命令执行流畅，基础扎实' : '通过排查找到正确方案，debug 能力不错',
      improvement: '试着用 --help 查看命令的完整参数列表',
      alternative: '',
      learningTip: session.level.aiContext?.relatedCommands?.join(', ') || 'man <命令名>',
    };
  }
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `cd game-server && npx jest --forceExit`
Expected: All tests pass

---

### Task 8: API 端点 + WebSocket 集成

**Files:**
- Modify: `game-server/server.js` (新增 /api/training/* 路由和 WebSocket 处理)

- [ ] **Step 1: Add training module imports and initialization to server.js**

After the existing module imports (around line 14), add:

```javascript
const OpenStackMock = require('./training/openstack-mock');
const LinuxSandbox = require('./training/linux-sandbox');
const TrainingEngine = require('./training/training-engine');
const { loadLevels, loadLevel } = require('./training/level-loader');
```

After the existing terminal initialization (around line 27), add:

```javascript
const trainingOs = new OpenStackMock();
const trainingLinux = new LinuxSandbox();
const trainingEngine = new TrainingEngine(trainingOs, trainingLinux);
```

- [ ] **Step 2: Add REST endpoints (before the HTTP server creation)**

```javascript
// ── Training mode endpoints ──
app.get('/api/training/levels', (req, res) => {
  res.json(loadLevels().map(l => ({
    id: l.id, category: l.category, mode: l.mode,
    order: l.order, title: l.title, timeLimit: l.timeLimit,
  })));
});

app.post('/api/training/start', (req, res) => {
  try {
    const { levelId } = req.body;
    const level = loadLevel(levelId);
    if (!level) return res.status(404).json({ success: false, error: '关卡不存在' });

    terminal.setTrainingMode(true);
    trainingEngine.loadLevel(level);

    broadcast({ type: 'training-start', state: trainingEngine.getState() });
    res.json({ success: true, state: trainingEngine.getState() });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/training/stop', (req, res) => {
  trainingEngine.stop();
  terminal.setTrainingMode(false);
  broadcast({ type: 'training-stop' });
  res.json({ success: true });
});

app.get('/api/training/state', (req, res) => {
  res.json(trainingEngine.getState());
});

app.post('/api/training/hint', (req, res) => {
  const state = trainingEngine.getState();
  if (!state.level) return res.status(400).json({ success: false, error: '无活动关卡' });
  const { hintIndex = 0 } = req.body;
  const hints = state.level.hints || [];
  if (hintIndex >= hints.length) return res.status(400).json({ success: false, error: '无更多提示' });
  broadcast({ type: 'training-hint', hint: hints[hintIndex], hintIndex });
  res.json({ success: true, hint: hints[hintIndex] });
});

app.get('/api/training/progress', (req, res) => {
  // In-memory progress tracking (can be persisted later)
  res.json({ completed: [], scores: {} });
});
```

- [ ] **Step 3: Add WebSocket message handling**

Add to the `handleWsMessage` switch statement:

```javascript
    case 'training-command': {
      let result;
      const cmd = message.command.trim();

      if (cmd.startsWith('openstack ')) {
        const output = trainingOs.exec(cmd);
        const success = !output.includes('not recognized') && !output.startsWith('Error');
        result = { success, output, command: cmd };
      } else {
        result = trainingLinux.exec(cmd);
      }

      ws.send(JSON.stringify({ type: 'terminal-output', ...result }));

      if (trainingEngine.active) {
        trainingEngine.recordCommand(cmd, result.success);
        const check = trainingEngine.checkCompletion();
        if (check.completed) {
          trainingEngine.completeLevel().then(async (data) => {
            // Optionally: AI review
            let review = null;
            try {
              review = await ai.reviewTraining(data.session);
            } catch (e) { /* review is optional */ }
            terminal.setTrainingMode(false);
            broadcast({ type: 'training-complete', score: data.score, review,
              session: { elapsed: data.session.elapsed,
                commandCount: data.session.commandHistory.length } });
          });
        } else {
          broadcast({ type: 'training-update', state: trainingEngine.getState() });
        }
      }
      break;
    }
```

- [ ] **Step 4: Run all tests to verify no regression**

Run: `cd game-server && npx jest --forceExit`
Expected: All tests pass

---

### Task 9: 前端 TrainingPanel 组件

**Files:**
- Create: `frontend/src/components/TrainingPanel.vue`

- [ ] **Step 1: Write TrainingPanel.vue**

```vue
<template>
  <div class="training-panel" v-if="trainingState.level">
    <h3>训练关卡</h3>

    <div class="level-progress">
      <span class="level-badge">{{ trainingState.level.category === 'openstack' ? 'OpenStack' : 'Linux' }}</span>
      <span class="level-mode">{{ trainingState.level.mode === 'task' ? '闯关' : '排错' }}</span>
    </div>

    <div class="level-title">{{ trainingState.level.title }}</div>

    <div class="level-description">{{ trainingState.level.description }}</div>

    <div class="timer-row">
      <span class="timer">{{ formattedTime }}</span>
      <span class="time-limit">/ {{ formattedLimit }}</span>
      <button class="hint-btn" @click="requestHint" :disabled="hintUsed >= hintCount">
        💡 提示 ({{ hintUsed }}/{{ hintCount }})
      </button>
    </div>

    <div v-if="currentHint" class="hint-box">{{ currentHint }}</div>

    <div class="command-count">
      已输入 {{ trainingState.commandCount || 0 }} 条命令
    </div>

    <button class="btn-stop" @click="stopTraining">放弃本关</button>
  </div>
  <div class="training-panel idle" v-else>
    <h3>训练模式</h3>
    <p class="idle-text">选择一个关卡开始训练</p>
  </div>
</template>

<script>
export default {
  name: 'TrainingPanel',
  props: {
    trainingState: { type: Object, default: () => ({}) },
  },
  emits: ['request-hint', 'stop-training'],
  data() {
    return { hintUsed: 0, currentHint: '' };
  },
  computed: {
    formattedTime() {
      const s = Math.floor(this.trainingState.elapsed || 0);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    },
    formattedLimit() {
      const s = this.trainingState.level?.timeLimit || 120;
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    },
    hintCount() {
      return this.trainingState.level?.hints?.length || 0;
    },
  },
  methods: {
    requestHint() {
      this.$emit('request-hint', this.hintUsed);
      this.hintUsed++;
    },
    stopTraining() {
      this.$emit('stop-training');
    },
    setHint(hint) { this.currentHint = hint; },
  },
};
</script>

<style scoped>
.training-panel h3 {
  font-size: 0.9rem; color: #8899aa; margin-bottom: 12px;
  text-transform: uppercase; letter-spacing: 2px; font-weight: 700;
}
.level-progress { display: flex; gap: 8px; margin-bottom: 10px; }
.level-badge {
  background: #0d2818; color: #4caf50; border: 1px solid #1a4a2a;
  padding: 3px 10px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
}
.level-mode {
  background: #1a0a2a; color: #bb86fc; border: 1px solid #2a1a4a;
  padding: 3px 10px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
}
.level-title {
  font-size: 1.1rem; font-weight: 700; color: #e0e0e0; margin-bottom: 10px;
}
.level-description {
  font-size: 0.85rem; color: #8899aa; line-height: 1.7; margin-bottom: 14px;
  white-space: pre-wrap;
}
.timer-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.timer { font-size: 1.6rem; font-family: 'JetBrains Mono', monospace; color: #ff6b35; font-weight: 800; }
.time-limit { color: #556; font-size: 1rem; }
.hint-btn {
  margin-left: auto; padding: 6px 12px; background: #1a1a2a;
  border: 1px solid #2a2a4a; color: #8899cc; cursor: pointer; font-size: 0.8rem;
}
.hint-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.hint-box {
  background: #0d1520; border: 1px solid #1a2a4a; padding: 10px;
  color: #88aacc; font-size: 0.85rem; margin-bottom: 10px;
}
.command-count { color: #445566; font-size: 0.8rem; margin-bottom: 10px; }
.btn-stop {
  padding: 10px 20px; background: #333; color: #888; border: none;
  cursor: pointer; font-size: 0.85rem;
}
.idle-text { color: #445566; font-size: 0.85rem; }
</style>
```

- [ ] **Step 2: Verify no build errors**

Run: `cd frontend && npx vite build`
Expected: Build succeeds

---

### Task 10: 前端 TrainingResultOverlay + App.vue/GameConsole 集成

**Files:**
- Create: `frontend/src/components/TrainingResultOverlay.vue`
- Modify: `frontend/src/App.vue` (import TrainingPanel, TrainingResultOverlay; add data/methods)
- Modify: `frontend/src/components/GameConsole.vue` (add training button)

- [ ] **Step 1: Write TrainingResultOverlay.vue**

```vue
<template>
  <div class="result-overlay">
    <div class="result-card">
      <h2>{{ levelPassed ? '关卡完成！' : '关卡超时' }}</h2>

      <div class="score-display" v-if="score">
        <div class="score-big">{{ score.total }}<span class="score-unit">/100</span></div>
        <div class="score-breakdown">
          <span>速度 {{ score.speed }}/50</span>
          <span>准确性 {{ score.accuracy }}/30</span>
          <span>规范 {{ score.standard }}/20</span>
        </div>
      </div>

      <div class="ai-review" v-if="review">
        <div class="review-label">AI 点评</div>
        <div class="review-item praise">{{ review.praise }}</div>
        <div class="review-item improvement">{{ review.improvement }}</div>
        <div class="review-item learning" v-if="review.learningTip">📚 {{ review.learningTip }}</div>
      </div>

      <div class="actions">
        <button class="btn-retry" @click="$emit('retry')">🔄 重试本关</button>
        <button class="btn-next" @click="$emit('next')">▶ 下一关</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'TrainingResultOverlay',
  props: { score: Object, review: Object, levelPassed: Boolean },
  emits: ['retry', 'next'],
};
</script>

<style scoped>
.result-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center; z-index: 110;
}
.result-card {
  background: #0c1016; border: 3px solid #1a2330; padding: 36px;
  max-width: 500px; width: 90%;
}
.result-card h2 { text-align: center; color: #ff6b35; font-size: 1.4rem; margin-bottom: 20px; }
.score-big { text-align: center; font-size: 3rem; font-weight: 800; color: #2ecc40; margin-bottom: 8px; }
.score-unit { font-size: 1.2rem; color: #558866; }
.score-breakdown { display: flex; justify-content: center; gap: 16px; color: #8899aa; font-size: 0.85rem; margin-bottom: 20px; }
.ai-review { background: #080d14; border: 2px solid #141d28; padding: 16px; margin-bottom: 20px; }
.review-label { color: #4488cc; font-size: 0.8rem; text-transform: uppercase; margin-bottom: 8px; font-weight: 700; }
.review-item { padding: 4px 0; font-size: 0.9rem; line-height: 1.5; }
.review-item.praise { color: #4caf50; }
.review-item.improvement { color: #ffaa00; }
.review-item.learning { color: #8899cc; margin-top: 6px; }
.actions { display: flex; gap: 12px; }
.btn-retry, .btn-next {
  flex: 1; padding: 14px; border: none; cursor: pointer;
  font-size: 1rem; font-weight: 700; text-transform: uppercase;
}
.btn-retry { background: #1a2a3a; color: #8899aa; }
.btn-next { background: #ff6b35; color: #fff; }
</style>
```

- [ ] **Step 2: Modify App.vue**

Add imports:
```javascript
import TrainingPanel from './components/TrainingPanel.vue';
import TrainingResultOverlay from './components/TrainingResultOverlay.vue';
```

Add to components: `TrainingPanel, TrainingResultOverlay`

Add to data:
```javascript
trainingState: {},
trainingScore: null,
trainingReview: null,
showTrainingResult: false,
```

Add to WebSocket message handler:
```javascript
case 'training-start':
  this.trainingState = msg.state;
  break;
case 'training-update':
  this.trainingState = msg.state;
  break;
case 'training-complete':
  this.trainingState = msg.state;
  this.trainingScore = msg.score;
  this.trainingReview = msg.review;
  this.showTrainingResult = true;
  break;
case 'training-stop':
  this.trainingState = {};
  this.showTrainingResult = false;
  break;
```

Add to methods:
```javascript
startTraining(levelId) {
  fetch('/api/training/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ levelId }),
  });
},
stopTraining() {
  fetch('/api/training/stop', { method: 'POST' });
  this.trainingState = {};
  this.showTrainingResult = false;
},
requestTrainingHint(hintIndex) {
  fetch('/api/training/hint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hintIndex }),
  });
},
```

Add to template (after dashboard):
```html
<div class="training-section" v-if="gameMode === 'training'">
  <TrainingPanel
    :training-state="trainingState"
    @request-hint="requestTrainingHint"
    @stop-training="stopTraining"
  />
</div>

<TrainingResultOverlay
  v-if="showTrainingResult"
  :score="trainingScore"
  :review="trainingReview"
  :level-passed="true"
  @retry="showTrainingResult = false"
  @next="showTrainingResult = false"
/>
```

Modify the dashboard to hide health/ai panels during training:
```html
<div class="dashboard" v-if="gameMode !== 'training'">
```

- [ ] **Step 3: Add training mode button to GameConsole.vue**

Add a "训练模式" button in the difficulty-actions area (IDLE state only):
```html
<button class="btn btn-start btn-train" @click="$emit('switch-mode', 'training')">
  训练模式
</button>
```

Add CSS:
```css
.btn-train { background: #1a1a4a; border-color: #2a2a6a; color: #bb86fc; }
.btn-train:hover { background: #2a2a5a; border-color: #4a4a8a; }
```

- [ ] **Step 4: Build and verify**

Run: `cd frontend && npx vite build`
Expected: Build succeeds

---

### Verification

After completing all tasks, verify end-to-end:

1. **Unit tests**: `cd game-server && npx jest --forceExit` — all tests pass
2. **Training mode start**: `curl -X POST http://localhost:3001/api/training/start -H 'Content-Type: application/json' -d '{"levelId":"openstack-task-01"}'` returns success
3. **OpenStack command**: Send `kubectl get pods` (should fail in training mode), then send `openstack image create ubuntu --disk-format qcow2` (should succeed)
4. **Level completion**: Check that training-complete WebSocket event fires with score
5. **Frontend**: TrainingPanel renders level info, TrainingResultOverlay shows after completion
6. **Practice/Real unaffected**: Switch back to practice mode, start a K8s game, verify it still works

---
