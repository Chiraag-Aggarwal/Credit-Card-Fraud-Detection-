import { useEffect, useState } from 'react'
import { createRequestScope } from '../utils/requestScope'

export default function useRequestScope() {
  const [scope] = useState(createRequestScope)
  useEffect(() => {
    scope.activate()
    return () => scope.dispose()
  }, [scope])
  return scope
}
