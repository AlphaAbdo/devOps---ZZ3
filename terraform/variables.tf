variable "cluster_name" {
  type        = string
  default     = "pixelwar"
  description = "nom du cluster kind"
}

variable "k8s_version" {
  type        = string
  default     = "v1.30.0"
  description = "tag de l'image node — doit correspondre à un tag kindest/node dispo"
}
