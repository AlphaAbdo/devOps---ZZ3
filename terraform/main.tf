terraform {
  required_version = ">= 1.7"

  required_providers {
    kind = {
      source  = "tehcyx/kind"
      version = "~> 0.5"
    }
  }
}

provider "kind" {}

resource "kind_cluster" "pixelwar" {
  name       = var.cluster_name
  node_image = "kindest/node:${var.k8s_version}"

  # écrit le kubeconfig à côté pour que kubectl le trouve direct
  kubeconfig_path = "${path.module}/kubeconfig"

  wait_for_ready = true

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    node {
      role = "control-plane"

      # expose le frontend sur le host — port 30080 mappé sur le NodePort
      extra_port_mappings {
        container_port = 30080
        host_port      = 30080
        protocol       = "TCP"
      }
    }

    node {
      role = "worker"
    }

    node {
      role = "worker"
    }
  }
}


