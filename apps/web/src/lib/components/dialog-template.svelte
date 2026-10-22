<script lang="ts">
  // Typed so importers get a declaration (svelte-check), no props.
</script>

<!-- Study Book dialog: paper panel, 2px ink top rule, square corners, no shadow. -->
<section
  class="rounded-[2px] border-t-2 border-fg bg-[color:var(--surface-strong-color)] p-6 text-[color:var(--font-color)]"
>
  <h2 class="mb-4 text-h2 font-bold leading-snug"><slot name="header" /></h2>
  <slot name="content" />
  <footer class="flex flex-wrap items-center justify-end gap-2 pt-5">
    <slot name="footer" />
  </footer>
</section>
