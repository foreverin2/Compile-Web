当在 src/ui/effects/ 触发 fire:discard 或 fire:delete 时，给目标卡牌添加 .card-burning 类并挂载粒子节点，动画结束（1.2s）后直接从 DOM 树移除即可：

<!-- 被焚烧的卡牌结构 -->
<div class="card card-burning">
  <!-- 原始卡牌内容 -->
  <div class="card-inner">...</div>

  <!-- 焚烧特效挂载层 -->
  <div class="fire-burn-overlay">
    <div class="fire-burn-flame"></div>
    <div class="fire-burn-sparks">
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
      <div class="fire-spark"></div>
    </div>
  </div>
</div>