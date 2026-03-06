'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useRouter } from 'next/navigation'
import { Upload, FileBox, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api'
import { useModelStore } from '@/stores/modelStore'
import { ModelMeta } from '@/lib/types'
import { toast } from 'sonner'
import { MAX_UPLOAD_MB } from '@/lib/constants'

interface UploadDropzoneProps {
  projectId: string
}

const ACCEPTED = {
  'model/gltf-binary': ['.glb'],
  'model/gltf+json': ['.gltf'],
  'application/octet-stream': ['.obj', '.stl', '.ifc'],
}

export default function UploadDropzone({ projectId }: UploadDropzoneProps) {
  const router = useRouter()
  const { setMetadata, setModelUrl, setUploadProgress, uploadProgress } = useModelStore()
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`File too large. Maximum size is ${MAX_UPLOAD_MB} MB.`)
      return
    }

    setError(null)
    setUploading(true)
    setUploadProgress(0)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('project_id', projectId)

    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 90))
      }

      const model: ModelMeta = await new Promise((resolve, reject) => {
        xhr.open('POST', `${process.env.NEXT_PUBLIC_FASTAPI_URL}/api/models/upload`)
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText))
          } else {
            reject(new Error(`Upload failed: ${xhr.statusText}`))
          }
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(formData)
      })

      setUploadProgress(100)
      setMetadata(model)
      setModelUrl(model.normalized_glb_url)

      await apiClient.patch(`/projects/${projectId}`, {
        model_id: model.id,
        current_step: 'place',
      })

      toast.success('Model uploaded successfully')
      router.push(`/projects/${projectId}/place`)
    } catch (err: any) {
      setError(err.message ?? 'Upload failed')
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }, [projectId, router, setMetadata, setModelUrl, setUploadProgress])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    maxFiles: 1,
    disabled: uploading,
  })

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50',
          uploading && 'opacity-60 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        <FileBox className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        {isDragActive ? (
          <p className="text-primary font-medium">Drop it here</p>
        ) : (
          <>
            <p className="font-medium mb-1">Drag & drop your model here</p>
            <p className="text-sm text-muted-foreground">or click to browse — GLB, GLTF, OBJ, STL, IFC</p>
            <p className="text-xs text-muted-foreground mt-1">Max {MAX_UPLOAD_MB} MB</p>
          </>
        )}
      </div>

      {uploading && (
        <div className="space-y-1">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            <Upload className="inline h-3 w-3 mr-1" />
            Uploading… {uploadProgress}%
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}
