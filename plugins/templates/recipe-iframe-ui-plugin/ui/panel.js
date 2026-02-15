const params = new URLSearchParams(window.location.search)
const storyId = params.get('storyId') || ''

document.getElementById('story').textContent = storyId ? `Story: ${storyId}` : 'No story selected'

document.getElementById('load').addEventListener('click', async () => {
  const out = document.getElementById('output')
  try {
    const response = await fetch(`/api/plugins/iframe-ui-recipe/panel-data?storyId=${encodeURIComponent(storyId)}`)
    const data = await response.json()
    out.textContent = JSON.stringify(data, null, 2)
  } catch (error) {
    out.textContent = String(error)
  }
})
