output "cluster_name" {
  value = kind_cluster.pixelwar.name
}

# le kubeconfig est écrit dans terraform/kubeconfig par la ressource elle-même
output "kubeconfig_file" {
  value     = "${path.module}/kubeconfig"
  sensitive = false
}
