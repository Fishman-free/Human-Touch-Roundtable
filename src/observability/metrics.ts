type Labels = Record<string, string>;
function identity(name: string, labels: Labels) {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error("INVALID_METRIC_NAME");
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || value.length > 80) throw new Error("INVALID_METRIC_LABEL");
  }
  return { key: `${name}\0${JSON.stringify(entries)}`, entries };
}
function formatLabels(entries: [string, string][]) {
  return entries.length ? `{${entries.map(([key, value]) => `${key}="${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`).join(",")}}` : "";
}

export class MetricsRegistry {
  private counters = new Map<string, { name: string; labels: [string, string][]; value: number }>();
  private observations = new Map<string, { name: string; labels: [string, string][]; count: number; sum: number }>();

  increment(name: string, labels: Labels = {}, value = 1) {
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_METRIC_VALUE");
    const id = identity(name, labels);
    const metric = this.counters.get(id.key) ?? { name, labels: id.entries, value: 0 };
    metric.value += value; this.counters.set(id.key, metric);
  }
  observe(name: string, value: number, labels: Labels = {}) {
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_METRIC_VALUE");
    const id = identity(name, labels);
    const metric = this.observations.get(id.key) ?? { name, labels: id.entries, count: 0, sum: 0 };
    metric.count++; metric.sum += value; this.observations.set(id.key, metric);
  }
  render() {
    const lines: string[] = [];
    for (const metric of [...this.counters.values()].sort((a, b) => `${a.name}${JSON.stringify(a.labels)}`.localeCompare(`${b.name}${JSON.stringify(b.labels)}`))) {
      lines.push(`${metric.name}${formatLabels(metric.labels)} ${metric.value}`);
    }
    for (const metric of [...this.observations.values()].sort((a, b) => `${a.name}${JSON.stringify(a.labels)}`.localeCompare(`${b.name}${JSON.stringify(b.labels)}`))) {
      const labels = formatLabels(metric.labels);
      lines.push(`${metric.name}_count${labels} ${metric.count}`, `${metric.name}_sum${labels} ${metric.sum}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
