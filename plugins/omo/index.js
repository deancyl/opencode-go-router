/**
 * Oh My OpenAgent (OMO) Plugin Entry Hook (plugins/omo/index.js)
 * ==============================================================
 * Connects the microkernel plugin system to OMO integrity checks,
 * OpenCode v2 directory wrapper patching, and deadlock elimination.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const updater = require('../../updater.js');

module.exports = {
  async init(context) {
    context.logger?.info('[Plugin:OMO] 初始化 Oh My OpenAgent 多智能体协同插件');
    return true;
  },

  async probe(context) {
    const omoInteg = updater.checkOmoPluginV2Integrity();
    const isHealthy = omoInteg.healthy && !omoInteg.hasDeadlockEffect && !omoInteg.hasMissingWrapper;

    let status = 'healthy';
    let message = 'OMO 插件配置与运行环境健康';

    if (omoInteg.hasDeadlockEffect) {
      status = 'degraded';
      message = '检测到 Effect-TS 死锁标记 (可能导致连接挂死)';
    } else if (omoInteg.hasMissingWrapper) {
      status = 'degraded';
      message = '缺少 OpenCode v2 目录安全包装器';
    } else if (!omoInteg.installed) {
      status = 'stopped';
      message = '未检测到本地 OMO 插件安装';
    }

    return {
      status,
      installed: omoInteg.installed,
      healthy: isHealthy,
      hasDeadlockEffect: omoInteg.hasDeadlockEffect,
      hasMissingWrapper: omoInteg.hasMissingWrapper,
      targetsCount: omoInteg.targetsCount,
      message
    };
  },

  async repair(context) {
    const patchRes = updater.patchOmoPluginV2();
    return patchRes;
  },

  async stop(context) {
    context.logger?.info('[Plugin:OMO] OMO 插件已卸载');
    return true;
  }
};
