# Chaos Fire Drill — 完整游戏攻略

## 游戏目标

系统随机注入 K8s 集群故障，你需要用 `kubectl` 命令排查并修复，与 AI 竞速。修得越快越准，分数越高。

---

## 三种游戏模式

| 模式 | K8s | 靶子服务 | 副本数 | 仪表盘 | 故障池 | Web 验证 |
|------|-----|---------|--------|--------|--------|---------|
| **练习** | Mock 模拟 | frontend, order-service, product-service | 2 | 完整详情 | 全部 8 种 | 无 |
| **Micro-Demo** | 真实集群 | frontend, order-service, product-service | 2 | 完整详情 | 全部 8 种 | `localhost:30080` |
| **Bookinfo** | 真实集群 | productpage-v1, details-v1, ratings-v1, reviews-v1 | 1 | 完整详情 | 仅 scale 型 4 种 | `localhost:30090/productpage` |

**难度**：Easy = 1 个故障 / Hard = 2 个故障

---

## 故障类型与排查修复（8 种）

### 第一类：副本缩容型（立刻可见，网站直接挂）

这 4 种故障都会把 Deployment 缩到 0 副本，**服务完全不可用**。用 `kubectl get deployments` 一眼就能看到 AVAILABLE=0。

#### 故障 1-4：kill-random-pod / scale-to-zero / kill-two-pods / process-crash

**症状**：某个（或两个）服务的 Deployment 显示 `0/0`，AVAILABLE=0。

**最快排查（10 秒）**：
```
kubectl get deployments
```
看哪一行的 AVAILABLE 列是 0。

**修复**：
```
kubectl scale deployment <服务名> --replicas=2
```
练习/Micro-Demo 模式恢复到 2 副本，Bookinfo 模式恢复到 1 副本。

---

### 第二类：资源压力型（服务变慢但不完全挂）

这 4 种故障不影响 Pod 的 Running 状态，需要深入 Pod 内部排查。

#### 故障 5：cpu-stress（CPU 压力）

**症状**：服务响应变慢，Pod CPU 飙升。

**排查**：
```
kubectl top pod
```
CPU 超过 80% 的 Pod 就是被注入的目标。

**修复**：
```
kubectl rollout restart deployment <服务名>
```
最简单且最快——滚动重启直接干掉压力进程。也可用 `kubectl exec <pod> -- pkill yes`。

#### 故障 6：memory-leak（内存泄漏）

**症状**：Pod 内存持续增长。

**排查**：
```
kubectl top pod
```
内存超过 80% 的 Pod 就是目标。

**修复**：
```
kubectl rollout restart deployment <服务名>
```
同 CPU 压力，restart 最省事。

#### 故障 7：disk-full（磁盘占满）

**症状**：Pod 磁盘空间不足，可能报 "no space left"。

**排查**：
```
kubectl exec <pod名称> -- df -h
```
看 `/tmp` 是否接近 100%。

**修复**：
```
kubectl exec <pod名称> -- rm -f /tmp/bigfile
```

#### 故障 8：network-delay（网络延迟 — Hard 专属）

**症状**：某个 Pod 的 READY 显示 `0/1`（STATUS 仍是 Running），页面加载极慢。

**排查**：
```
kubectl get pods
```
看 READY 列有没有 `0/1`（正常的全是 `1/1`）。

**修复**：
```
kubectl rollout restart deployment <服务名>
```
滚动重启自动清除 tc 规则。

---

## 速查表

| 你想知道什么 | 命令 |
|-------------|------|
| 哪些服务挂了（第一眼） | `kubectl get deployments` |
| Pod 状态 + READY | `kubectl get pods` |
| CPU/内存使用率 | `kubectl top pod` |
| Pod 详细信息 | `kubectl describe pod <名称>` |
| Pod 日志 | `kubectl logs <名称>` |
| Pod 内执行命令 | `kubectl exec <名称> -- <命令>` |
| 查看事件 | `kubectl get events` |
| 修复缩容故障 | `kubectl scale deployment <名> --replicas=2` |
| 万能修复（重启） | `kubectl rollout restart deployment <名>` |
| 查看命名空间 | `kubectl get ns` |

---

## 快速定位流程

### 30 秒速通法（适用于所有模式）

```
1. kubectl get deployments          ← 看谁 AVAILABLE=0
2. 如果有 → scale 修复              ← 90% 的故障在这一步就解决了
3. 如果都正常 → kubectl get pods    ← 看谁 READY≠1/1
4. 如果 READY 异常 → kubectl top pod ← 看 CPU/内存谁飙高
5. 找到目标 → rollout restart 或 exec 修复
```

**核心原则**：`kubectl get deployments` 是最高效的第一步——4/8 的故障直接暴露在这里。

---

## 各模式服务名速查

### 练习 / Micro-Demo 模式

| 服务 | 健康副本数 | 修复命令模板 |
|------|-----------|------------|
| frontend | 2 | `kubectl scale deployment frontend --replicas=2` |
| order-service | 2 | `kubectl scale deployment order-service --replicas=2` |
| product-service | 2 | `kubectl scale deployment product-service --replicas=2` |

### Bookinfo 模式

| 服务 | 健康副本数 | 修复命令模板 |
|------|-----------|------------|
| productpage-v1 | 1 | `kubectl scale deployment productpage-v1 --replicas=1` |
| details-v1 | 1 | `kubectl scale deployment details-v1 --replicas=1` |
| ratings-v1 | 1 | `kubectl scale deployment ratings-v1 --replicas=1` |
| reviews-v1 | 1 | `kubectl scale deployment reviews-v1 --replicas=1` |

终端命令自动追加命名空间（`-n chaos-game`/`-n demo-micro`/`-n default`），不需要手动指定。

---

## 战胜 AI 的策略

AI 的诊断时间线：**10 秒先手 → 3~8 秒诊断修复**。你有约 **13 秒**的黄金窗口。

**速通 SOP**：
1. 告警弹出 → 立刻敲 `kubectl get deployments`（3 秒）
2. 锁定 0 副本的服务 → `kubectl scale deployment xxx --replicas=2`（5 秒）
3. 如果 deployment 全正常 → `kubectl get pods`（2 秒）→ `kubectl rollout restart deployment xxx`（3 秒）

**终极技巧**：不清楚哪个服务挂了？对练习/Micro-Demo 模式直接盲打三连：
```
kubectl scale deployment frontend --replicas=2
kubectl scale deployment order-service --replicas=2
kubectl scale deployment product-service --replicas=2
```
scale 对健康服务无副作用，三连打完保证所有缩容故障全部修复，5 秒搞定。

---

## 实战模式 Web 验证

- **Micro-Demo**：打开 `http://localhost:30080`，故障注入后页面报错或加载失败
- **Bookinfo**：打开 `http://localhost:30090/productpage`，被缩容的服务对应区域显示红字报错

修复后在页面上能看到服务即时恢复。

---

## 结算评分

| 维度 | 分值 | 怎么拿高分 |
|------|------|-----------|
| Speed 速度 | 35 | 比 AI 快 |
| Accuracy 准确 | 20 | 用 `scale --replicas=` 精确修复（而非 restart） |
| Standard 规范 | 15 | 命令包含 `kubectl` + `-n <命名空间>` + `--replicas=` |
| Cost 成本 | 30 | 命令越少越好，不要过度配置 Pod 数 |

AI 在 Standard 维度默认满分（15 分），成本也较低。人类需要在 Speed 和 Accuracy 上拉开差距。
