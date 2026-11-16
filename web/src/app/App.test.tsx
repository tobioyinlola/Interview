import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { App } from './App'

describe('App', () => {
  it('shows the not-supported page outside desktop Chromium', () => {
    // jsdom has no getDisplayMedia, so the gate must trigger.
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText(/isn't supported/i)).toBeInTheDocument()
  })
})
