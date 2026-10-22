<script lang="ts">
  /**
   * Study Book key-point box: a 2px spot-colour frame with a label tag ("Today") and the one key
   * figure of the screen. Anything in the default slot goes below the figure.
   */
  export let label: string;
  export let figure: number | string;
  export let unit = '';

  $: shown = typeof figure === 'number' ? figure.toLocaleString('en-US') : figure;
</script>

<section class="point-box" aria-label={label}>
  <span class="point-box-tag" aria-hidden="true">{label}</span>
  <p class="point-box-figure">
    {shown}{#if unit}<span class="point-box-unit">{unit}</span>{/if}
  </p>
  <slot />
</section>

<style>
  .point-box {
    position: relative;
    padding: 1.75rem 1.25rem 1.25rem;
    border: 2px solid var(--accent-color);
    border-radius: 2px;
    background: var(--background-color);
  }

  .point-box-tag {
    position: absolute;
    top: -2px;
    left: -2px;
    padding: 0.2rem 0.6rem;
    border-radius: 2px 0 2px 0;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
    line-height: 1.4;
  }

  .point-box-figure {
    color: var(--font-color);
    font-size: var(--type-figure);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .point-box-unit {
    margin-left: 0.35rem;
    color: var(--app-muted-fg);
    font-size: var(--type-body);
    font-weight: 400;
  }
</style>
