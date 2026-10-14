import React from 'react'
import { createRoot } from 'react-dom/client'
import { MochilaApp } from './MochilaApp'
import './mochila.css'
createRoot(document.getElementById('root')!).render(<React.StrictMode><MochilaApp /></React.StrictMode>)
