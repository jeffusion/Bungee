<script lang="ts">
  import { toast } from '../stores/toast';
  import Toast from './Toast.svelte';

  function handleClose(id: number) {
    toast.remove(id);
  }
</script>

{#each $toast as item (item.id)}
  <Toast
    message={item.message}
    type={item.type}
    duration={item.duration}
    on:close={() => handleClose(item.id)}
  />
{/each}
