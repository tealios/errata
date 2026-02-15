const params = new URLSearchParams(window.location.search)
const storyId = params.get('storyId')

const storyEl = document.getElementById('story-id')
const outputEl = document.getElementById('output')
const pingBtn = document.getElementById('ping')

storyEl.textContent = storyId ? `Story: ${storyId}` : 'No storyId provided'

pingBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/plugins/my-plugin/health')
    const data = await response.json()
    outputEl.textContent = JSON.stringify(data, null, 2)
  } catch (error) {
    outputEl.textContent = String(error)
  }
})
