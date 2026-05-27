# Chaos Fire Drill 游戏攻略

## 游戏目标

系统会随机注入故障，你需要用 kubectl 命令排查并修复它，和 AI 竞速。

## 难度模式

| 模式 | 故障数量 | 故障类型 |
|------|---------|---------|
| 简单 (Easy) | 1 个 | scale-to-zero / kill-random-pod |
| 困难 (Hard) | 2 个 | 以上 + network-delay / kill-two-pods |

---

## 故障类型与排查修复

### 故障一：scale-to-zero（某个 Deployment 被缩容为 0）

**症状**：某个服务的所有 Pod 全部消失，服务完全不可用。

**排查命令**：

```
kubectl get deployments
```

观察输出中哪个 Deployment 的 `AVAILABLE` 列为 0 → 那就是被攻击的目标。

**修复命令**：

```
kubectl scale deployment <服务名> --replicas=2
```

例如：
```
kubectl scale deployment order-service --replicas=2
```

---

### 故障二：kill-random-pod / kill-two-pods（副本数缩减）

**easy 模式**：某个服务被缩容到 1 副本（READY 显示 1/2）
**hard 模式**：两个服务同时被缩容到 1 副本

**排查命令**：

```
kubectl get deployments
```

看哪些 Deployment 的 READY 列变成了 `1/2`。

**修复命令**：

```
kubectl scale deployment <服务名> --replicas=2
```

例如：
```
kubectl scale deployment product-service --replicas=2
```

hard 模式下需要修复两个服务——先用 `kubectl get deployments` 找出所有 READY 不足的服务。

---

### 故障三：network-delay（网络延迟 — hard 专属）

**症状**：某个 Pod 的 READY 列显示 `0/1`（虽然 STATUS 是 Running），网络请求变慢。

**排查命令**：

```
kubectl get pods
```

看 `READY` 列是否有 `0/1` 而非正常的 `1/1`。

**修复命令**：

```
kubectl exec <pod名称> -- tc qdisc del dev eth0 root
```

例如：
```
kubectl exec frontend-abc123 -- tc qdisc del dev eth0 root
```

如果 exec 命令不熟悉，也可以用：
```
kubectl rollout restart deployment <服务名>
```

---

### 故障三：cpu-stress（CPU 压力）

**症状**：某个 Pod 的 CPU 使用率飙升，服务响应变慢。

**排查命令**：
```
kubectl top pod
```

观察哪个 Pod 的 CPU 使用率异常高。

**修复命令**：
```
kubectl exec <pod名称> -- pkill -f "while.*:"
```

---
### 故障四：memory-leak（内存泄漏）

**症状**：某个 Pod 的内存持续增长，可能触发 OOM。

**排查命令**：
```
kubectl top pod
```

观察哪个 Pod 的内存使用率异常高。

**修复命令**：
```
kubectl exec <pod名称> -- pkill tail
```

---
### 故障五：disk-full（磁盘占满）

**症状**：某个 Pod 的磁盘空间被占满，服务报 "no space left" 错误。

**排查命令**：
```
kubectl exec <pod名称> -- df -h
```

**修复命令**：
```
kubectl exec <pod名称> -- rm -f /tmp/bigfile
```

---
### 故障六：process-crash（进程崩溃）

**症状**：某个 Pod 的 RESTARTS 列计数增加，或者 STATUS 显示 CrashLoopBackOff。

**排查命令**：
```
kubectl get pods
```

观察 RESTARTS 列。

**修复命令**：
```
kubectl describe pod <pod名称>
kubectl rollout restart deployment <服务名>
```

---
## 排查速查表

| 你想知道什么 | 命令 |
|-------------|------|
| 有哪些 Pod，状态如何 | `kubectl get pods` |
| 有哪些 Deployment，副本数正常吗 | `kubectl get deployments` |
| 某个 Pod 的详细状态 | `kubectl describe pod <pod名称>` |
| 查看某个 Pod 的日志 | `kubectl logs <pod名称>` |
| 查看最近的事件 | `kubectl get events` |
| 调整副本数（修复用） | `kubectl scale deployment <服务名> --replicas=2` |
| 滚动重启某个服务 | `kubectl rollout restart deployment <服务名>` |
| 在 Pod 内执行命令 | `kubectl exec <pod名称> -- <命令>` |

---

## 通关流程

### Easy 模式（30 秒内搞定）

1. 点「简单模式」→ 等待故障注入（3 秒）
2. 输入 `kubectl get deployments` → 看哪个 Deployment 的 AVAILABLE 变 0 了
3. 如果 deployment 全正常，输入 `kubectl get pods` → 看哪个服务少了 Pod
4. 找到故障后，输入 `kubectl scale deployment <问题服务名> --replicas=2`
5. 等 1-2 秒，服务恢复 → 结算面板弹出

### Hard 模式

1. 点「困难模式」→ 等待双重故障注入
2. 先用 `kubectl get deployments` 检查缩容
3. 再用 `kubectl get pods` 检查 Pod 数量和 READY 状态
4. 逐一修复每个故障
5. 两个故障都修好 → 结算面板弹出

**核心思路**：对所有 3 个服务依次执行 `kubectl scale deployment <服务名> --replicas=2` — scale 命令对正常服务没有副作用，这是最快的方法。

---

## 可用服务名

- `frontend`
- `order-service`
- `product-service`

终端中输入的命令会自动追加 `-n chaos-game`，不需要手动指定命名空间。
